#!/usr/bin/env node
import { runCli } from "../adapters/cli.js";

process.exitCode = await runCli();
