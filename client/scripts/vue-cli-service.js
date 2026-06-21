"use strict";

const childProcess = require("child_process");

const nodeOptions = [
    process.env.NODE_OPTIONS,
    "--openssl-legacy-provider"
].filter(Boolean).join(" ");

const result = childProcess.spawnSync(
    process.execPath,
    [
        require.resolve("@vue/cli-service/bin/vue-cli-service.js"),
        ...process.argv.slice(2)
    ],
    {
        env: {
            ...process.env,
            NODE_OPTIONS: nodeOptions
        },
        stdio: "inherit"
    }
);

if (result.error) {
    throw result.error;
}

process.exit(result.status);
