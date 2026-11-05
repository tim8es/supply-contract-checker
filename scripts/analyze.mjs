#!/usr/bin/env node
/** Offline batch adapter; suitable for cron/Actions/n8n Execute Command. No API keys. */
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, dirname, basename } from 'node:path';
import { analyze, toPublicResult, toIso } from '../src/engine.mjs';
import { penaltyRateExtractor } from '../src/extractors/penalty.mjs';

export function argumentsFrom(args) {
  const flags = { input: 'documents', date: '2026-03-10', output: null, withPenalty: false };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--help' || key === '-h') return { help: true };
    if (key === '--with-penalty') { flags.withPenalty=true; continue; }
    if (!['--input','--date','--output'].includes(key) || !args[i+1]) {
      throw new Error('Неизвестный или неполный аргумент: ' + key);
    }
    flags[key.slice(2)] = args[++i];
  }
  if (toIso(flags.date) !== flags.date) throw new Error('Неверная дата ISO: ' + flags.date);
  return flags;
}

export async function batch({ input, date, output, withPenalty=false }) {
  const directory = resolve(input);
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries.filter(e => e.isFile() && extname(e.name).toLowerCase() === '.txt')
    .map(e => e.name).sort();
  if (names.length === 0) throw new Error('В папке отсутствуют TXT-файлы: ' + directory);
  if (names.length > 10000) throw new Error('Слишком много TXT-файлов за один запуск');
  const files = await Promise.all(names.map(async name => {
    const text = await readFile(resolve(directory, name), 'utf8');
    if (Buffer.byteLength(text) > 2_000_000) throw new Error('Превышен размер 2 МБ: ' + basename(name));
    return { name, text };
  }));
  const snapshot = toPublicResult(analyze(files, date,
    withPenalty ? {extractors:[penaltyRateExtractor]} : {}));
  const json = JSON.stringify(snapshot, null, 2) + '\n';
  if (output) {
    await mkdir(dirname(resolve(output)), { recursive: true });
    await writeFile(resolve(output), json, 'utf8');
  }
  return { json, snapshot };
}
if (process.argv[1] && new URL(import.meta.url).pathname === resolve(process.argv[1])) {
  try {
    const args = argumentsFrom(process.argv.slice(2));
    if (args.help) {
      process.stdout.write('node scripts/analyze.mjs --input documents --date 2026-03-10 [--with-penalty] [--output artifacts/report.json]\n');
    } else {
      const { json, snapshot } = await batch(args);
      if (args.output) process.stderr.write('Saved: ' + args.output + ' (' + snapshot.contracts.length + ' contracts)\n');
      else process.stdout.write(json);
    }
  } catch (error) {
    process.stderr.write('Batch analysis failed: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
