#!/usr/bin/env node
// Avorelo CLI entry point for npm package distribution.
// Loads the pre-built JS bundle so it works inside node_modules.
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
const dist = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "avorelo.mjs");
await import(pathToFileURL(dist).href);
