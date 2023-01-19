import path from "path";
import chokidar from "chokidar";
import { readFile, rename, rm } from "fs/promises";

interface Config {
  watchFolders: WatchFolder[];
}

interface WatchFolder {
  path: string;
  usePolling?: boolean;
  pollingInterval?: number;
  ignoreDotFiles: boolean;
  conditions: WatchCondition[];
  noMatchedAction: "none" | "move" | "delete";
  noMatchedDestination?: string;
}

interface WatchCondition {
  type: "file" | "folder" | "any";
  pattern: string | RegExp;
  action: "move" | "delete";
  destination?: string;
  renamePattern?: {
    searchValue: string | RegExp;
    replaceValue: string;
    excludeExtension?: boolean;
  };
}

async function loadConfig() {
  const config = await readFile("./config.json", "utf-8").then((data) => JSON.parse(data));
  return config as Config;
}

async function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const watchers: chokidar.FSWatcher[] = [];

  let config = await loadConfig();
  const configWatcher = chokidar.watch("./config.json", {
    ignoreInitial: true,
    persistent: true,
  });
  configWatcher.on("change", async () => {
    console.log("Config file changed, reloading");
    await Promise.all(watchers.map(async (watcher) => await watcher.close()));
    await pause(500);
    config = await loadConfig();
    watchers.splice(0, watchers.length);
    for (const options of config.watchFolders) {
      watchers.push(await addWatch(options));
    }
  });
  for (const options of config.watchFolders) {
    watchers.push(await addWatch(options));
  }
}

async function addWatch(options: WatchFolder) {
  if (options.noMatchedAction == "move" && !options.noMatchedDestination) {
    throw new Error("noMatchedDestination is required when noMatchedAction is set to move");
  }

  const ignoreDotFiles = /(^|[\/\\])\../;
  const watcher = chokidar.watch(options.path, {
    ignored: options.ignoreDotFiles ? ignoreDotFiles : undefined,
    ignoreInitial: true,
    usePolling: options.usePolling,
    interval: options.pollingInterval,
    binaryInterval: options.pollingInterval,
    persistent: true,
  });
  watcher.on("ready", () => {
    console.log(`Watching ${options.path} for ${options.conditions.length} conditions`);
  });
  watcher.on("add", async (file) => await onAdd("file", file, options));
  watcher.on("addDir", async (folder) => await onAdd("folder", folder, options));
  watcher.on("change", async (file) => await onAdd("file", file, options));

  return watcher;
}

async function onAdd(type: "file" | "folder", file: string, options: WatchFolder) {
  const checkResult = await getConditionMatch(type, file, options.conditions);
  const originalFilename = path.basename(file);
  let filename = path.basename(file);
  if (checkResult && checkResult.action == "move") {
    if (!checkResult.destination) {
      throw new Error("destination is required when action is set to move");
    }
    if (checkResult.renamePattern) {
      let extension = "";
      if (checkResult.renamePattern.excludeExtension) {
        extension = path.extname(filename);
        filename = filename.replace(extension, "");
      }
      filename = filename.replace(
        new RegExp(checkResult.renamePattern.searchValue),
        checkResult.renamePattern.replaceValue
      );
      filename += extension;
    }
    console.log(
      `Moving ${originalFilename} to ${checkResult.destination}` + checkResult.renamePattern
        ? ` with filename ${filename}`
        : ""
    );
    await rename(file, path.join(checkResult.destination, filename));
  } else if (checkResult && checkResult.action == "delete") {
    console.log(`Deleting ${filename}`);
    await rm(file);
  } else if (options.noMatchedAction == "move") {
    console.log(`Moving ${filename} to ${options.noMatchedDestination}`);
    await rename(file, path.join(options.noMatchedDestination!, filename));
  } else if (options.noMatchedAction == "delete") {
    console.log(`Deleting ${filename}`);
    await rm(file);
  }
}

async function getConditionMatch(type: "file" | "folder", path: string, conditions: WatchCondition[]) {
  for (const condition of conditions) {
    if (typeof condition.pattern === "string") {
      condition.pattern = new RegExp(condition.pattern);
    }
    if ((condition.type === "any" || condition.type === type) && condition.pattern.test(path)) {
      return condition;
    }
  }
  return false;
}

main().catch((err) => console.error(err));
