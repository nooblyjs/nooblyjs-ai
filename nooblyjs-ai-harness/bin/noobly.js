#!/usr/bin/env node
// The `noobly` command starts here.
//
// Our UI files are written in JSX (<Box>, <Text> ...), which Node cannot run
// directly. `tsx` teaches Node to compile .jsx on the fly, so we have no build step.
//
// We point tsx at noobly's OWN tsconfig.json. Otherwise it looks in the folder
// you run noobly from, which is usually another project, and the JSX settings
// ("jsx": "react-jsx") wouldn't be found.
import { fileURLToPath } from 'node:url';
import { register } from 'tsx/esm/api';

register({ tsconfig: fileURLToPath(new URL('../tsconfig.json', import.meta.url)) });
await import('../src/cli.js');
