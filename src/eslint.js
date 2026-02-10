import {execa} from "execa";

function getArgs() {
    const args = [...process.argv];
    args.shift(); // remove node
    args.shift(); // remove command
    return args.filter(a => a !== '--fix');
}

async function run(args) {
    let stdout = '';
    try {
        let result = await execa('npx', args, {env: {...process.env}});
        stdout = result.stdout;
    } catch (error) {
        console.error(error.stderr);

        if (error.exitCode !== 1) {
            console.error(error.stderr);
            return null;
        }

        stdout = error.stdout;
    }

    return stdout;
}

async function execute() {
    const args = ['eslint', '-f', 'json', ...getArgs()];
    const stdout = await run(args);
    if (!stdout) return null;
    return JSON.parse(stdout);
}

async function fix() {
    const args = ['eslint', '--fix', ...getArgs()];
    await run(args);
}

export default {
    execute,
    fix
}