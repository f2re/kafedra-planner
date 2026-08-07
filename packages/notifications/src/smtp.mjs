import net from 'node:net';
import tls from 'node:tls';
import { once } from 'node:events';

function safeHeader(value) {
  return String(value || '').replace(/[\r\n]+/gu, ' ').trim();
}

function mailbox(value) {
  const clean = safeHeader(value);
  const bracket = /<([^<>\s]+@[^<>\s]+)>/u.exec(clean)?.[1];
  const address = bracket || clean;
  if (!/^[^\s@<>]+@[^\s@<>]+$/u.test(address)) throw new Error('smtp_address_invalid');
  return address;
}

function encodedSubject(value) {
  return `=?UTF-8?B?${Buffer.from(safeHeader(value), 'utf8').toString('base64')}?=`;
}

class ReplyReader {
  constructor(socket) {
    this.lines = [];
    this.waiters = [];
    this.buffer = '';
    this.socket = null;
    this.onData = (chunk) => {
      this.buffer += chunk;
      while (this.buffer.includes('\n')) {
        const index = this.buffer.indexOf('\n');
        const line = this.buffer.slice(0, index).replace(/\r$/u, '');
        this.buffer = this.buffer.slice(index + 1);
        const waiter = this.waiters.shift();
        if (waiter) waiter.resolve(line);
        else this.lines.push(line);
      }
    };
    this.onError = (error) => this.rejectWaiters(error);
    this.onClose = () => this.rejectWaiters(new Error('smtp_connection_closed'));
    this.attach(socket);
  }

  rejectWaiters(error) {
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  detach() {
    if (!this.socket) return;
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('close', this.onClose);
    this.socket = null;
  }

  attach(socket) {
    this.detach();
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
  }

  async line() {
    if (this.lines.length) return this.lines.shift();
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  async reply() {
    const lines = [];
    while (true) {
      const line = await this.line();
      lines.push(line);
      const match = /^(\d{3})([ -])/u.exec(line);
      if (match && match[2] === ' ') return { code: Number(match[1]), lines };
    }
  }
}

function expectCode(reply, expected, label) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(reply.code)) throw new Error(`smtp_${label}_${reply.code || 'invalid'}`);
}

async function connectSocket({ host, port, secure, rejectUnauthorized, timeoutMs }) {
  const socket = secure
    ? tls.connect({ host, port, servername: host, rejectUnauthorized })
    : net.createConnection({ host, port });
  socket.setTimeout(timeoutMs, () => socket.destroy(new Error('smtp_timeout')));
  await once(socket, secure ? 'secureConnect' : 'connect');
  return socket;
}

async function command(socket, reader, text) {
  socket.write(`${text}\r\n`);
  return reader.reply();
}

async function authenticate(socket, reader, username, password) {
  if (!username) return;
  const plain = Buffer.from(`\u0000${username}\u0000${password || ''}`, 'utf8').toString('base64');
  let reply = await command(socket, reader, `AUTH PLAIN ${plain}`);
  if (reply.code === 235) return;
  reply = await command(socket, reader, 'AUTH LOGIN');
  expectCode(reply, 334, 'auth_login');
  reply = await command(socket, reader, Buffer.from(username, 'utf8').toString('base64'));
  expectCode(reply, 334, 'auth_username');
  reply = await command(socket, reader, Buffer.from(password || '', 'utf8').toString('base64'));
  expectCode(reply, 235, 'auth_password');
}

function buildMessage({ from, to, subject, body, messageId }) {
  const normalizedBody = String(body || '').replaceAll('\r\n', '\n').replaceAll('\r', '\n')
    .split('\n').map((line) => line.startsWith('.') ? `.${line}` : line).join('\r\n');
  return [
    `From: ${safeHeader(from)}`,
    `To: ${mailbox(to)}`,
    `Subject: ${encodedSubject(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${safeHeader(messageId)}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    normalizedBody,
    '.'
  ].join('\r\n');
}

export async function sendSmtpMessage({
  host,
  port = 25,
  secure = false,
  startTls = true,
  requireTls = false,
  rejectUnauthorized = true,
  username = '',
  password = '',
  from,
  to,
  subject,
  body,
  messageId,
  timeoutMs = 15000,
  clientName = 'kafedra-planner'
}) {
  if (!host || !from || !to) throw new Error('smtp_not_configured');
  let socket = await connectSocket({ host, port, secure, rejectUnauthorized, timeoutMs });
  const reader = new ReplyReader(socket);
  try {
    let reply = await reader.reply();
    expectCode(reply, 220, 'greeting');
    reply = await command(socket, reader, `EHLO ${safeHeader(clientName) || 'kafedra-planner'}`);
    expectCode(reply, 250, 'ehlo');
    const capabilities = reply.lines.join('\n').toUpperCase();

    if (!secure && startTls && capabilities.includes('STARTTLS')) {
      reply = await command(socket, reader, 'STARTTLS');
      expectCode(reply, 220, 'starttls');
      reader.detach();
      const upgraded = tls.connect({ socket, servername: host, rejectUnauthorized });
      upgraded.setTimeout(timeoutMs, () => upgraded.destroy(new Error('smtp_timeout')));
      await once(upgraded, 'secureConnect');
      socket = upgraded;
      reader.attach(socket);
      reply = await command(socket, reader, `EHLO ${safeHeader(clientName) || 'kafedra-planner'}`);
      expectCode(reply, 250, 'ehlo_tls');
    } else if (!secure && requireTls) {
      throw new Error('smtp_tls_required');
    }

    await authenticate(socket, reader, safeHeader(username), String(password || ''));
    reply = await command(socket, reader, `MAIL FROM:<${mailbox(from)}>`);
    expectCode(reply, 250, 'mail_from');
    reply = await command(socket, reader, `RCPT TO:<${mailbox(to)}>`);
    expectCode(reply, [250, 251], 'rcpt_to');
    reply = await command(socket, reader, 'DATA');
    expectCode(reply, 354, 'data');
    socket.write(`${buildMessage({ from, to, subject, body, messageId })}\r\n`);
    reply = await reader.reply();
    expectCode(reply, 250, 'accepted');
    const providerMessage = reply.lines.at(-1)?.slice(4).trim() || null;
    command(socket, reader, 'QUIT').catch(() => {});
    return { accepted: true, messageId, providerMessage };
  } finally {
    reader.detach();
    socket.end();
  }
}
