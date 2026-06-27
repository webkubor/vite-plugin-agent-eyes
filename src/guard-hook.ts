/**
 * agentGuard hook 脚本生成（§agentGuard）
 * 路由：无
 * API：无；生成无 dev server 依赖的自包含 Node ESM Git hook。
 */

import type { AgentGuardOptions } from './guard-types'

const HOOK_RUNTIME_SOURCE = String.raw`
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_REPORT_FILE = 'log/guard-report.json';
const DEFAULT_LARGE_FILE_BLOCK_BYTES = 1024 * 1024;
const DEFAULT_FILE_LENGTH_WARN = 400;
const DEFAULT_FILE_LENGTH_BLOCK = 800;
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/,
  /\b(?:token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*['"][^'"]{12,}['"]/i,
  /\bsk[-_](?:live|test|proj)[-_][a-z0-9_-]{12,}/i,
  /https:\/\/(?:open\.feishu\.cn|oapi\.dingtalk\.com|qyapi\.weixin\.qq\.com)\/[^\s'"]+/i,
];
const GIT_DIFF_ARGS = ['diff', '--cached', '--unified=0', '--no-ext-diff'];

function severityFor(level, requested, fallback) {
  if (level === 'warn') return 'warn';
  if (requested === 'warn' || requested === 'block') return requested;
  return fallback;
}

function enabledFor(checks, key) {
  if (!checks) return true;
  if (Array.isArray(checks)) return checks.includes(key);
  return checks[key] !== false;
}

function switchValue(checks, key) {
  if (!checks || Array.isArray(checks)) return undefined;
  const value = checks[key];
  return value && typeof value === 'object' ? undefined : value;
}

function largeFilesOptions(checks) {
  if (!checks || Array.isArray(checks)) return {};
  return checks.largeFiles && typeof checks.largeFiles === 'object' ? checks.largeFiles : {};
}

function fileLengthOptions(checks) {
  if (!checks || Array.isArray(checks)) return {};
  return checks.fileLength && typeof checks.fileLength === 'object' ? checks.fileLength : {};
}

function normalizedSwitch(level, checks, key, fallback) {
  return { enabled: enabledFor(checks, key), severity: severityFor(level, switchValue(checks, key), fallback) };
}

function normalizeGuardConfig(options = {}) {
  const level = options.level ?? 'block';
  const checks = options.checks;
  const largeFiles = largeFilesOptions(checks);
  const fileLength = fileLengthOptions(checks);
  return {
    level,
    reportFile: options.reportFile ?? DEFAULT_REPORT_FILE,
    checks: {
      secrets: normalizedSwitch(level, checks, 'secrets', 'block'),
      largeFiles: { enabled: enabledFor(checks, 'largeFiles'), severity: severityFor(level, switchValue(checks, 'largeFiles'), 'block'), blockBytes: largeFiles.blockBytes ?? DEFAULT_LARGE_FILE_BLOCK_BYTES },
      fileLength: { enabled: enabledFor(checks, 'fileLength'), severity: severityFor(level, switchValue(checks, 'fileLength'), 'warn'), warn: fileLength.warn ?? DEFAULT_FILE_LENGTH_WARN, block: fileLength.block ?? DEFAULT_FILE_LENGTH_BLOCK },
      todo: normalizedSwitch(level, checks, 'todo', 'warn'),
      noAny: normalizedSwitch(level, checks, 'noAny', 'warn'),
      noConsoleLog: normalizedSwitch(level, checks, 'noConsoleLog', 'warn'),
    },
  };
}

function gitText(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitBuffer(cwd, args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function parseAddedLines(diff) {
  const addedLines = [];
  let nextLine;
  for (const rawLine of diff.split(/\r?\n/)) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);
    if (hunk) nextLine = Number(hunk[1]);
    else if (nextLine !== undefined && rawLine.startsWith('+')) {
      addedLines.push({ line: nextLine, text: rawLine.slice(1) });
      nextLine += 1;
    } else if (nextLine !== undefined && (!rawLine.startsWith('-') || rawLine.startsWith('---'))) {
      nextLine += rawLine.startsWith(' ') ? 1 : 0;
    }
  }
  return addedLines;
}

function splitNul(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean);
}

function collectStagedFiles(cwd) {
  const names = splitNul(gitBuffer(cwd, ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']));
  return names.map((filePath) => stagedFileFromPath(cwd, filePath));
}

function stagedFileFromPath(cwd, filePath) {
  try {
    const buffer = gitBuffer(cwd, ['show', ':' + filePath]);
    const binary = buffer.includes(0);
    const diff = binary ? '' : gitText(cwd, [...GIT_DIFF_ARGS, '--', filePath]);
    return { path: filePath, content: binary ? '' : buffer.toString('utf8'), addedLines: binary ? [] : parseAddedLines(diff), bytes: buffer.byteLength, binary };
  } catch {
    return { path: filePath, content: '', addedLines: [], bytes: 0, binary: true };
  }
}

function isTypeScriptFile(filePath) {
  return /\.(?:ts|tsx)$/.test(filePath);
}

function isConsoleLogFile(filePath) {
  return /\.(?:ts|tsx|js|jsx|vue|svelte)$/.test(filePath);
}

function lineCount(content) {
  if (!content) return 0;
  const withoutFinalNewline = content.replace(/\r?\n$/, '');
  return withoutFinalNewline ? withoutFinalNewline.split(/\r?\n/).length : 0;
}

function secretLineKeys(addedLines) {
  const keys = new Set();
  for (const added of addedLines) {
    if (SECRET_PATTERNS.some((pattern) => pattern.test(added.text))) keys.add(added.line);
  }
  return keys;
}

function addedLineItem(check, severity, file, added, message) {
  return { check, severity, file: file.path, line: added.line, message };
}

function stripCommentAndStringText(text) {
  const quotePattern = new RegExp('([\\x22\\x27\\x60])(?:\\\\.|(?!\\1).)*\\1', 'g');
  return text.replace(quotePattern, '').replace(/\/\*.*?\*\//g, '').split('//')[0] ?? '';
}

function hasTypeAny(text) {
  const code = stripCommentAndStringText(text);
  return /:\s*any\b/.test(code) || /\bas\s+any\b/.test(code) || /<\s*any\s*>/.test(code) || /<[^>\n]*\bany\b[^>\n]*>/.test(code);
}

function runTextChecks(file, config) {
  const items = [];
  if (config.checks.largeFiles.enabled && file.bytes > config.checks.largeFiles.blockBytes) {
    items.push({ check: 'largeFiles', severity: config.checks.largeFiles.severity, file: file.path, message: String(file.bytes) + ' bytes exceeds ' + String(config.checks.largeFiles.blockBytes) + ' bytes' });
  }
  const lines = lineCount(file.content);
  if (config.checks.fileLength.enabled && lines >= config.checks.fileLength.block) {
    items.push({ check: 'fileLength', severity: config.level === 'warn' ? 'warn' : 'block', file: file.path, message: String(lines) + ' lines exceeds block threshold ' + String(config.checks.fileLength.block) });
  } else if (config.checks.fileLength.enabled && lines >= config.checks.fileLength.warn) {
    items.push({ check: 'fileLength', severity: config.checks.fileLength.severity, file: file.path, message: String(lines) + ' lines exceeds warn threshold ' + String(config.checks.fileLength.warn) });
  }
  const secretLines = config.checks.secrets.enabled ? secretLineKeys(file.addedLines) : new Set();
  if (config.checks.secrets.enabled) for (const added of file.addedLines) {
    if (secretLines.has(added.line)) items.push(addedLineItem('secrets', config.checks.secrets.severity, file, added, '疑似 hardcoded secret/token/webhook'));
  }
  if (config.checks.todo.enabled) for (const added of file.addedLines) {
    if (!secretLines.has(added.line) && /\b(?:TODO|FIXME|HACK)\b/.test(added.text)) items.push(addedLineItem('todo', config.checks.todo.severity, file, added, '新增 TODO/FIXME/HACK'));
  }
  if (config.checks.noAny.enabled && isTypeScriptFile(file.path)) for (const added of file.addedLines) {
    if (!secretLines.has(added.line) && hasTypeAny(added.text)) items.push(addedLineItem('noAny', config.checks.noAny.severity, file, added, '新增 TypeScript any'));
  }
  if (config.checks.noConsoleLog.enabled && isConsoleLogFile(file.path)) for (const added of file.addedLines) {
    if (!secretLines.has(added.line) && /\bconsole\.log\s*\(/.test(added.text)) items.push(addedLineItem('noConsoleLog', config.checks.noConsoleLog.severity, file, added, '新增 console.log'));
  }
  return items;
}

function summarizeItems(items) {
  return { block: items.filter((item) => item.severity === 'block').length, warn: items.filter((item) => item.severity === 'warn').length };
}

function resultFromItems(level, items) {
  const summary = summarizeItems(items);
  return { level, passed: summary.block === 0, summary, items };
}

function reportPath(cwd, reportFile) {
  return path.isAbsolute(reportFile) ? reportFile : path.join(cwd, reportFile);
}

function writeGuardReport(cwd, reportFile, result) {
  const file = reportPath(cwd, reportFile);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
}

function guardErrorItem(error) {
  const message = error instanceof Error ? error.message : String(error);
  return { check: 'guard', severity: 'block', message: 'git staged file collection failed: ' + message };
}

function reportWriteMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return 'guard report write failed: ' + message;
}

function finalizeGuardResult(cwd, reportFile, result) {
  try {
    writeGuardReport(cwd, reportFile, result);
    return result;
  } catch (error) {
    return { ...result, reportError: reportWriteMessage(error) };
  }
}

function runGuard(options = {}, cwd = process.cwd()) {
  const config = normalizeGuardConfig(options);
  try {
    const items = collectStagedFiles(cwd).flatMap((file) => runTextChecks(file, config));
    return finalizeGuardResult(cwd, config.reportFile, resultFromItems(config.level, items));
  } catch (error) {
    return finalizeGuardResult(cwd, config.reportFile, resultFromItems(config.level, [guardErrorItem(error)]));
  }
}

function itemLocation(item) {
  if (!item.file) return '';
  return item.line === undefined ? item.file + ': ' : item.file + ':' + String(item.line) + ': ';
}

function renderGuardReport(result) {
  const status = result.passed ? 'PASS' : 'BLOCK';
  const lines = ['[agent-eyes:guard] ' + status + ' block=' + String(result.summary.block) + ' warn=' + String(result.summary.warn)];
  for (const item of result.items) lines.push('- ' + item.severity + ' ' + item.check + ': ' + itemLocation(item) + item.message);
  if (result.reportError) lines.push('- notice report: ' + result.reportError);
  return lines.join('\n');
}
`

/** 创建可直接写入 Git hook 的自包含 Node ESM guard 脚本。 */
export function createGuardHookScript(options: AgentGuardOptions = {}): string {
  const optionsJson = JSON.stringify(options)
  return [
    '#!/usr/bin/env node',
    HOOK_RUNTIME_SOURCE.trim(),
    `const result = runGuard(${optionsJson}, process.cwd());`,
    'console.log(renderGuardReport(result));',
    'process.exit(result.passed ? 0 : 1);',
    '',
  ].join('\n')
}
