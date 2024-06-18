# krist-wallet-gen
Multi-threaded NodeJS program to find Krist addresses with specific endings.

## How To Use
Simply run the program and it will print out the help text, which gives you all the information you need in order to use the program.

## Additional Tuning Variables
Some aspects of KWG can be configured by setting environment variables. As of right now, there's only two, and they are documented below.

### KWG_THREADS
Setting this environment variable will force KWG to use the number of threads you specify.
One NodeJS process gets created for each thread, so be careful setting it too high, or you could end up running out of RAM.

Default behavior is to call `os.availableParallelism()` (or `os.cpus().length` if that fails - e.g. on older NodeJS versions) to determine how many threads to run. 
This means KWG will by default use 100% of all your CPU cores. You might not want this if you're running it in the background of your desktop PC for extended amounts of time.

### KWG_REPORT_INTERVAL
This environment variable changes how many checks to perform before worker threads send performance updates back to the main thread. By default, it is set to 100.
This can be useful for getting more performance on systems where you have many cores, but where each individual core might not be too fast. Or if you're running an insane amount of threads for some reason.
Changing it should in theory decrease the load on the main thread as it won't have to process performance updates as often, though setting it too high can make the speed display either update slowly, or not at all.
