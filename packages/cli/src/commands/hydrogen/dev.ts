import path from 'path';
import fs from 'fs-extra';
import * as remix from '@remix-run/dev/dist/compiler.js';
import {copyPublicFiles, runBuild} from './build.js';
import {getProjectPaths, getRemixConfig} from '../../utils/config.js';
import {muteDevLogs} from '../../utils/log.js';
import {flags} from '../../utils/flags.js';

import Command from '@shopify/cli-kit/node/base-command';
import {Flags} from '@oclif/core';
import {startMiniOxygen} from '../../utils/mini-oxygen.js';

const LOG_INITIAL_BUILD = '\n🏁 Initial build';
const LOG_REBUILDING = '🧱 Rebuilding...';
const LOG_REBUILT = '🚀 Rebuilt';

// @ts-ignore
export default class Dev extends Command {
  static description =
    'Runs Hydrogen storefront in a MiniOxygen worker in development';
  static flags = {
    ...flags,
    port: Flags.integer({
      description: 'Port to run the preview server on',
      env: 'SHOPIFY_HYDROGEN_FLAG_PORT',
      default: 3000,
    }),
    entry: Flags.string({
      env: 'SHOPIFY_HYDROGEN_FLAG_ENTRY',
      default: 'oxygen.ts',
    }),
  };

  async run(): Promise<void> {
    // @ts-ignore
    const {flags} = await this.parse(Dev);
    const directory = flags.path ? path.resolve(flags.path) : process.cwd();

    await runDev({...flags, path: directory});
  }
}

export async function runDev({
  entry,
  port,
  path: appPath,
}: {
  entry: string;
  port?: number;
  path?: string;
}) {
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'development';

  const projectPaths = getProjectPaths(appPath, entry);
  const {root, entryFile, publicPath} = projectPaths;
  const remixConfig = await getRemixConfig(root, entryFile, publicPath);

  muteDevLogs();

  await compileAndWatch(remixConfig, projectPaths, {port});
}

async function compileAndWatch(
  remixConfig: Awaited<ReturnType<typeof getRemixConfig>>,
  projectPaths: ReturnType<typeof getProjectPaths>,
  options: {port?: number} = {},
  isInit = true,
) {
  isInit && console.time(LOG_INITIAL_BUILD);

  const {root, entryFile, publicPath, buildPathClient, buildPathWorkerFile} =
    projectPaths;
  const copyingFiles = copyPublicFiles(publicPath, buildPathClient);

  const stopCompileWatcher = await remix.watch(remixConfig, {
    mode: process.env.NODE_ENV as any,
    async onFileCreated(file: string) {
      console.log(`\n📄 File created: ${path.relative(root, file)}`);
      if (file.startsWith(publicPath)) {
        await copyPublicFiles(
          file,
          path.resolve(buildPathClient, path.basename(file)),
        );
      }
    },
    async onFileChanged(file: string) {
      console.log(`\n📄 File changed: ${path.relative(root, file)}`);
      if (file.startsWith(publicPath)) {
        await copyPublicFiles(
          file,
          path.resolve(buildPathClient, path.basename(file)),
        );
      }

      if (file.startsWith(path.resolve(root, 'remix.config.'))) {
        const [newRemixConfig] = await Promise.all([
          getRemixConfig(root, entryFile, publicPath, file),
          stopCompileWatcher(),
        ]);

        compileAndWatch(newRemixConfig, projectPaths, options, false);
      }
    },
    async onFileDeleted(file: string) {
      console.log(`\n📄 File deleted: ${path.relative(root, file)}`);
      if (file.startsWith(publicPath)) {
        await fs.unlink(file.replace(publicPath, buildPathClient));
      }
    },
    async onInitialBuild() {
      await copyingFiles;

      if (isInit) {
        console.timeEnd(LOG_INITIAL_BUILD);

        await startMiniOxygen({
          root,
          port: options.port,
          watch: true,
          buildPathWorkerFile,
          buildPathClient,
        });
      }
    },
    onRebuildStart() {
      // eslint-disable-next-line no-console
      console.log(LOG_REBUILDING);
      console.time(LOG_REBUILT);
    },
    async onRebuildFinish() {
      console.timeEnd(LOG_REBUILT);
    },
  });
}
