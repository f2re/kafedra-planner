#!/usr/bin/env node
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { GRACE_MERGE_CHECK, REQUIRED_MAIN_CHECKS } from './grace-required-checks.mjs';

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
      failed.push({
        name,
        conclusion: check.conclusion || 'unknown',
        detailsUrl: check.details_url || null
      });
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
  const [owner, repo] = String(repository).split('/');
  if (!owner || !repo) throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);
  const apiBase = process.env.GITHUB_API_URL || 'https://api.github.com';
  const all = [];

  for (let page = 1; page <= 10; page += 1) {
    const url = `${apiBase}/repos/${owner}/${repo}/commits/${sha}/check-runs?filter=latest&per_page=100&page=${page}`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'kafedra-planner-grace-merge-gate',
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

async function main() {
  const contract = process.env.GRACE_CONTRACT_RESULT;
  const database = process.env.GRACE_DATABASE_RESULT;
  if (contract !== 'success' || database !== 'success') {
    throw new Error(`GRACE prerequisites failed: contract=${contract || 'unknown'}, database=${database || 'unknown'}.`);
  }

  const repository = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GRACE_HEAD_SHA || process.env.GITHUB_SHA;
  const token = process.env.GITHUB_TOKEN;
  if (!repository || !sha || !token) {
    throw new Error('GITHUB_REPOSITORY, GRACE_HEAD_SHA/GITHUB_SHA and GITHUB_TOKEN are required.');
  }
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error(`Invalid exact head SHA: ${sha}`);

  const required = REQUIRED_MAIN_CHECKS.filter((name) => name !== GRACE_MERGE_CHECK);
  const timeoutSeconds = Number.parseInt(process.env.GRACE_GATE_TIMEOUT_SECONDS || '21000', 10);
  const pollSeconds = Number.parseInt(process.env.GRACE_GATE_POLL_SECONDS || '15', 10);
  const deadline = Date.now() + Math.max(60, timeoutSeconds) * 1000;
  let lastSummary = '';

  while (Date.now() < deadline) {
    const checkRuns = await fetchCheckRuns({ repository, sha, token });
    const state = evaluateRequiredChecks(checkRuns, required);
    if (state.failed.length > 0) {
      throw new Error(`Required checks failed for ${sha}: ${state.failed.map((item) => `${item.name}=${item.conclusion}`).join(', ')}`);
    }
    if (state.complete) {
      console.log(`GRACE merge gate accepted exact SHA ${sha}: ${state.successful.join(', ')}.`);
      return;
    }

    const summary = JSON.stringify({ missing: state.missing, pending: state.pending });
    if (summary !== lastSummary) {
      console.log(`Waiting for exact-SHA checks ${sha}: ${summary}`);
      lastSummary = summary;
    }
    await sleep(Math.max(5, pollSeconds) * 1000);
  }

  throw new Error(`Timed out waiting for required checks on ${sha}. Last state: ${lastSummary}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
