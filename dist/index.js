"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const chokidar_1 = __importDefault(require("chokidar"));
const promises_1 = require("fs/promises");
async function loadConfig() {
    const config = await (0, promises_1.readFile)("./config.json", "utf-8").then((data) => JSON.parse(data));
    return config;
}
async function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function main() {
    const watchers = [];
    let config = await loadConfig();
    const configWatcher = chokidar_1.default.watch("./config.json", {
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
async function addWatch(options) {
    if (options.noMatchedAction == "move" && !options.noMatchedDestination) {
        throw new Error("noMatchedDestination is required when noMatchedAction is set to move");
    }
    const ignoreDotFiles = /(^|[\/\\])\../;
    const watcher = chokidar_1.default.watch(options.path, {
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
async function onAdd(type, file, options) {
    const checkResult = await getConditionMatch(type, file, options.conditions);
    const originalFilename = path_1.default.basename(file);
    let filename = path_1.default.basename(file);
    if (checkResult && checkResult.action == "move") {
        if (!checkResult.destination) {
            throw new Error("destination is required when action is set to move");
        }
        if (checkResult.renamePattern) {
            let extension = "";
            if (checkResult.renamePattern.excludeExtension) {
                extension = path_1.default.extname(filename);
                filename = filename.replace(extension, "");
            }
            filename = filename.replace(new RegExp(checkResult.renamePattern.searchValue), checkResult.renamePattern.replaceValue);
            filename += extension;
        }
        console.log(`Moving ${originalFilename} to ${checkResult.destination}` + checkResult.renamePattern
            ? ` with filename ${filename}`
            : "");
        await (0, promises_1.rename)(file, path_1.default.join(checkResult.destination, filename));
    }
    else if (checkResult && checkResult.action == "delete") {
        console.log(`Deleting ${filename}`);
        await (0, promises_1.rm)(file);
    }
    else if (options.noMatchedAction == "move") {
        console.log(`Moving ${filename} to ${options.noMatchedDestination}`);
        await (0, promises_1.rename)(file, path_1.default.join(options.noMatchedDestination, filename));
    }
    else if (options.noMatchedAction == "delete") {
        console.log(`Deleting ${filename}`);
        await (0, promises_1.rm)(file);
    }
}
async function getConditionMatch(type, path, conditions) {
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
