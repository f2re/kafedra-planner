#!/usr/bin/env node
import { setTimeout as sleep } from 'node:timers/promises';

export const DEFAULT_REQUIRED_CHECKS = [
  'Минимальный Node 24.15',
  'test',
  'browser',
  'Сборщик под host Node 25.6',
  'Full offline Debian 12 + Project Control'
];

export function latestChecksByName(checkRuns) {
  const latest = new Map();
  for (const check of checkRuns) {
    const previous = latest.get(check.name);
    if (!previous || Number(check.id) > Number(previous.id)) latest.set(check.name, check);
  }
  return latest;
}

export function evaluateRequiredChecks(checkRuns, requiredNames) {
  const latest = latestChecksByName(checkRuns);
  const missing = [];
  const pending = [];
  const failed = [];
  const successful = [];
  for (const name of requiredNames) {
    const check = latest.get(name);
    if (!check) {
      missing.push(name);
      continue;
    }
    if (check.status !== 'completed') {
      pending.push({ name, status: check.status });
      continue;
    }
    if (check.conclusion !== 'success') {
      failed.push({ name, conclusion: check.conclusion || 'unknown', detailsUrl: check.details_url || null });
      continue;
    }
    successful.push(name);
  }
  return {
    complete: missing.length === 0 && pending.length === 0 && failed.length === 0,
    missing,
    pending,
    failed,
    successful
  };
}

async function fetchCheckRuns({ repository, sha, token }) {
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) throw new Error(`Некорректный GITHUB_REPOSITORY: ${repository}`);
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'kafedra-planner-grace-gate',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub Checks API ${response.status}: ${body}`);
    }
    const payload = await response.json();
    const pageRuns = Array.isArray(payload.check_runs) ? payload.check_runs : [];
    all.push(...pageRuns);
    if (pageRuns.length < 100) break;
  }
  return all;
}

function parseRequiredChecks() {
  const raw = process.env.GRACE_REQUIRED_CHECKS;
  if (!raw) return DEFAULT_REQUIRED_CHECKS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || !item.trim())) {
      throw new Error('ожидался JSON-массив непустых строк');
    }
    return parsed;
  } catch (error) {
    throw new Error(`GRACE_REQUIRED_CHECKS: ${error.message}`);
  }
}

async function main() {
  const contractResult = process.env.GRACE_CONTRACT_RESULT;
  const ready = process.env.GRACE_READY;
  if (contractResult !== 'success') {
    throw new Error(`GRACE contract завершён как ${contractResult || 'unknown'}, слияние запрещено.`);
  }
  if (ready !== 'true') {
    throw new Error('GRACE bundle ещё active или не переведён в applied archive; ветка не достигла финальной стадии.');
  }

  const repository = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  const token = process.env.GITHUB_TOKEN;
  if (!repository || !sha || !token) throw new Error('Для merge-gate требуются GITHUB_REPOSITORY, GITHUB_SHA и GITHUB_TOKEN.');
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error(`Некорректный GITHUB_SHA: ${sha}`);

  const required = parseRequiredChecks();
  const timeoutSeconds = Number.parseInt(process.env.GRACE_GATE_TIMEOUT_SECONDS || '21600', 10);
  const pollSeconds = Number.parseInt(process.env.GRACE_GATE_POLL_SECONDS || '15', 10);
  const deadline = Date.now() + Math.max(60, timeoutSeconds) * 1000;
  let lastSummary = '';

  while (Date.now() < deadline) {
    const checkRuns = await fetchCheckRuns({ repository, sha, token });
    const state = evaluateRequiredChecks(checkRuns, required);
    if (state.failed.length > 0) {
      throw new Error(`Обязательные проверки завершились неуспешно: ${state.failed.map((item) => `${item.name}=${item.conclusion}`).join(', ')}`);
    }
    if (state.complete) {
      console.log(`GRACE merge gate: SHA ${sha} подтверждён; успешны ${state.successful.join(', ')}.`);
      return;
    }
    const summary = JSON.stringify({ missing: state.missing, pending: state.pending });
    if (summary !== lastSummary) {
      console.log(`Ожидание обязательных checks для ${sha}: ${summary}`);
      lastSummary = summary;
    }
    await sleep(Math.max(5, pollSeconds) * 1000);
  }
  throw new Error(`Истёк timeout ожидания обязательных checks для ${sha}. Последнее состояние: ${lastSummary}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
