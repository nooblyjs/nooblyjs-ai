#!/usr/bin/env node

const { exec } = require('child_process');
const os = require('os');



function killPort() {
    let command;

    let PORT = 11101;
    PORT = process.argv.slice(2)[0] || PORT;

    if (os.platform() === 'win32') {
        // Windows
        command = `netstat -ano | findstr :${PORT} | for /f "tokens=5" %a in ('find /v ""') do taskkill /pid %a /f`;
    } else {
        // macOS and Linux
        command = `lsof -t -i:${PORT} | xargs kill -9 2>/dev/null`;
    }

    exec(command, (error, stdout, stderr) => {
        if (error) {
            if (error.code === 1 || stderr.includes('No such process')) {
                console.log(`✓ No process running on port ${PORT}`);
                process.exit(0);
            } else {
                console.error(`✗ Error killing process on port ${PORT}:`, error.message);
                process.exit(1);
            }
        } else {
            console.log(`✓ Successfully killed process on port ${PORT}`);
            process.exit(0);
        }
    });
}

killPort();
