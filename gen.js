const help_text = `
Krist Wallet Generator - Generate passwords for Krist wallets that have specific suffixes.

Usage:
node gen.js <target_string> [num_results]

Example:
node gen.js test 4 // This will generate 4 Krist wallet and password combos that contain the word "test" at the end of them.

You can also specify multiple target strings by simply separating them with a comma.

Example:
node gen.js test,foo 4 // This will generate 4 Krist wallets and passwords that *either* contain the word "test", or the word "foo" at the end.

This program is multithreaded. By default, it will use one thread per CPU core.
If you wish to override this behavior, you can do so using the KWG_THREADS environment variable.
You can use this feature to either scale down the number of threads, allowing this program to run in the background,
or you can force it to use more workers than you have available CPU cores. Be cautious when doing the latter, as it provides diminishing returns, or sometimes none at all.

Example:
KWG_THREADS=1 node gen.js test 4 // Same as the first example - but will only spawn one worker thread.
`

const crypto = require("crypto");
const cluster = require('cluster');
const os = require('os');
const process = require('process');
const fs = require('fs');
const clear = `\r\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\r`;
let num_workers = process.env.KWG_THREADS ? Number(process.env.KWG_THREADS) : numCPUs;
let report_interval = process.env.KWG_REPORT_INTERVAL ? Number(process.env.KWG_REPORT_INTERVAL) : 100;
let bytes = process.env.KWG_BYTES ? Number(process.env.KWG_BYTES) : 32;
let threads = [];
let target = Number(process.argv[3]?process.argv[3]:1);
let progress = 0;
let last_perf = Date.now();
let perf_data = [];
let last_perf_line = "";
let numCPUs
try {
	numCPUs = os.availableParallelism();
} catch(err) {
	if(cluster.isPrimary) console.log("[main] Notice: os.availableParallelism() produced an error, guessing how many threads to run. You're probably running this script with an outdated version of NodeJS.");
	numCPUs = os.cpus().length;
}

function sha256(string) {
	return crypto.createHash('sha256').update(string).digest('hex');
}

function doubleSHA256(m) {return sha256(sha256(m))}

function hexToBase36(input) {
	const byte = 48 + Math.floor(input / 7);
	return String.fromCharCode(byte + 39 > 122 ? 101 : byte > 57 ? byte + 39 : byte);
}

// TODO: optimize me
function makeV2Address(chain, key) {
	const chars = ["", "", "", "", "", "", "", ""];
	// let chain = addressPrefix;
	let hash = doubleSHA256(key);
	for (let i = 0; i <= 8; i++) {
		chars[i] = hash.substring(0, 2);
		hash = doubleSHA256(hash);
	}
	for (let i = 0; i <= 8;) {
		let ii = 2*i;
		const index = parseInt(hash.substring(ii, 2 + (ii)), 16) % 9;
		if (!chars[index]) {
			hash = sha256(hash);
		} else {
			chain += hexToBase36(parseInt(chars[index], 16));
			chars[index] = "";
			i++;
		}
	}
	return chain;
}

let sanity = makeV2Address("k","abcdefghijklmnopqrstuvwxyz");
if(sanity !== "k8860qxhvw") {
	if(cluster.isPrimary) {
		process.exit(1);
	} else {
		process.send(JSON.stringify({
			intent: "fatal_error",
			msg: `SANITY CHECK FAILED! (expected "k8860qxhvw", got "${sanity}".)`,
			pid: process.pid
		}))
	}
}

function logger(msg) {
	process.stdout.write(`${clear}${msg}\n${last_perf_line}`);
}

function handleMessage(e) {
	let o;
	try {
		o = JSON.parse(e);
	} catch(e) {
		// console.log("ERROR: bad json received");
		if(cluster.isPrimary) {
			logger(`[main] Received bad JSON from a worker. Terminating all threads.`);
			finishProgram(1);
		} else {
			process.send(JSON.stringify({
				intent: "fatal_error",
				msg: "Failed to parse JSON from main thread.",
				pid: process.pid
			}));
			process.exit(1);
		}
	}
	if(cluster.isPrimary) {
		switch(o.intent) {
			case "message":
				logger(`[${o.pid}] ${o.msg}`);
				break;
			case "solution":
				progress++;
				logger(`[${o.pid}] SOLVED (${progress}/${target})! Password: ${o.seed} / Address: ${o.addr}`);
				if(progress >= target) finishProgram();
				break;
			case "fatal_error":
				logger(`[main] Fatal error received from thread ${o.pid}: ${o.msg}`);
				finishProgram(1);
				break;
			case "perf_info":
				perf_data.push(o.cps);
				if(Date.now() - last_perf > 1000) {
					let avg = 0;
					for(const entry of perf_data) {
						avg += entry/perf_data.length;
					}
					last_perf = Date.now();
					perf_data = [];
					last_perf_line = `Speed: approximately ${Number(avg*num_workers).toFixed(2)} checks per second.`
					process.stdout.write(`${clear}${last_perf_line}`);
				}
				break;
		}
	} else {
		switch(o.intent) {
			case "work":
				process.send(JSON.stringify({
					intent: "message",
					pid: process.pid,
					msg: "Received work!"
				}));
				threadWork(o.data);
				break;
		}
	}
}

function finishProgram(c=0) {
	logger(`[main] Killing all threads...`);
	threads.forEach(t => t.kill());
	process.exit(c);
}

if(cluster.isPrimary) {
	if(!process.argv[2]) {
		console.log(help_text);
		process.exit();
	}
	// fs.writeFileSync("a.tmp",process.argv[2]);
	logger(`[main] Searching for the following terms:\n - ${process.argv[2].split(",").join("\n - ")}`);
	logger(`[main] Dispatching ${num_workers} threads...`);
	for(i=0; i<num_workers; i++) {
		let thread = cluster.fork();
		thread.on('message', handleMessage);
		threads.push(thread);
	}
	logger(`[main] All threads dispatched, sending work...`);
	threads.forEach(t => {
		t.send(JSON.stringify({
			intent: "work",
			data: process.argv[2].split(",")
		}));
	});
} else {
	// const search = fs.readFileSync("a.tmp").toString();
	process.send(JSON.stringify({
		intent: "message",
		pid: process.pid,
		msg: "Hello! Waiting for work."
	}));
	process.on('message', handleMessage);
}

function threadWork(search) {
	if(!search) {
		process.send(JSON.stringify({
			intent: "fatal_error",
			msg: "Attempted to execute threadWork() with no data passed.",
			pid: process.pid
		}));
		return process.exit(1);
	}
	let counter = 0;
	let start_time = Date.now();
	while(true) {
		counter++;
		let a = `${crypto.randomBytes(bytes).toString('hex')}`;
		let b = makeV2Address("k", a);
		let result = false;
		for(const term of search) {
			if(b.endsWith(term)) result = true;
		}
		// if(result) console.log(`${a}, ${b}, ${result}`);
		if(result) {
			process.send(JSON.stringify({
				intent: "solution",
				seed: a,
				addr: b,
				pid: process.pid
			}));
		}
		//let cps = counter / (Date.now() - start_time) * 1000;
		let cps = ((Date.now() - start_time) * 1000) / counter;
		if(counter % report_interval == 0) {
			process.send(JSON.stringify({
				intent: "perf_info",
				pid: process.pid,
				cps: cps
			}));
		}
	}
}
