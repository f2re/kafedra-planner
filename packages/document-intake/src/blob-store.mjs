import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { once } from 'node:events';
import { AppError } from '../../core/src/errors.mjs';

export async function storeIncomingStream(stream, {
  blobDir,
  tempDir,
  maxBytes,
  mediaType = 'application/octet-stream'
}) {
  await mkdir(blobDir, { recursive: true });
  await mkdir(tempDir, { recursive: true });
  const tempPath = join(tempDir, `upload-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const output = createWriteStream(tempPath, { flags: 'wx', mode: 0o600 });
  const hash = createHash('sha256');
  let size = 0;
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > maxBytes) {
        throw new AppError('upload_too_large', `Файл превышает допустимый размер ${maxBytes} байт.`, 413);
      }
      hash.update(chunk);
      if (!output.write(chunk)) await once(output, 'drain');
    }
    output.end();
    await once(output, 'close');
    const sha256 = hash.digest('hex');
    const storagePath = join(blobDir, sha256.slice(0, 2), sha256.slice(2, 4), sha256);
    await mkdir(dirname(storagePath), { recursive: true });
    try {
      await rename(tempPath, storagePath);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await rm(tempPath, { force: true });
    }
    const actual = await stat(storagePath);
    if (actual.size !== size) {
      throw new AppError('blob_size_mismatch', 'Размер сохранённого файла не совпал с принятым потоком.', 500);
    }
    return { sha256, sizeBytes: size, storagePath, mediaType };
  } catch (error) {
    output.destroy();
    await rm(tempPath, { force: true });
    throw error;
  }
}
