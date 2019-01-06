const gittask = require("./gittasks.js");
const taggers = require("./taggers.js");
const cluster = require("cluster");
const fs = require("fs");
const Yaml = require("js-yaml");
const config = Yaml.safeLoad(fs.readFileSync(__dirname + "/config.yml", "utf8"));
const Queue = require("promise-queue");
const GlobToRegexp = require("glob-to-regexp");

function do_fill_stags(msg){
    const reposname = msg.reposname;
    const slot = msg.slot;
    const concurrency = msg.concurrency;
    const count = msg.count;
    if(config.repos[reposname].annotations){
        const tagger = taggers.make_tagger(config.repos[reposname].annotations);
        gittask.fill_stags(config.db.url,
                           config.repos[reposname].path,
                           config.repos[reposname].zone,
                           reposname, tagger, false, 
                           count, concurrency).then(e => {
                               console.log("Worker: Done",msg);
                               process.send(e);
                               process.exit(0);
                           });
    }else{
        console.log("Worker: Skip. No annotation defined for", reposname);
        process.send({progresscount: 0});
        process.exit(0);
    }
}

function do_fill_moredata(msg){
    const reposname = msg.reposname;
    const slot = msg.slot;
    const concurrency = msg.concurrency;
    const count = msg.count;
    gittask.fill_moredata(config.db.url,
                          config.repos[reposname].path,
                          config.repos[reposname].zone,
                          reposname, slot, false, 
                          count, concurrency).then(e => {
                              console.log("Worker: Done",msg);
                              process.send(e);
                              process.exit(0);
                          });
                          
}

function do_fill_mainhistory(msg){
    const reposname = msg.reposname;
    let options = {};
    if(config.repos[reposname].fetch){
        options.ref_regexp = config.repos[reposname].fetch.map(e => {
            return GlobToRegexp(e);
        });
    }
    gittask.fill_mainhistory(config.db.url,
                             config.repos[reposname].path,
                             config.repos[reposname].zone,
                             reposname, options).then(e => {
                                 console.log("Worker: Done",msg);
                                 process.exit(0);
                             });
}

function proc_repository_mainhistory(reposname){ // Promise
    return new Promise((done, err) => {
        const worker = cluster.fork();
        worker.send({reposname: reposname,
                    code: "fill_mainhistory"});
        cluster.on("exit", (w, code, signal) => {
            if(code != 0){
                err(new Error("Unexpected worker exit"));
            }else{
                done(0);
            }
        })
    });
}

function proc_repository_moredata0(reposname, slot){ // Promise
    const concurrency = slot == "parents" ? 1 : 32;
    const count = 10000;

    return new Promise((done, err) => {
        const worker = cluster.fork();
        let conclude = false;
        let progresscount = -1;
        function handler(w, msg, handle){
            console.log("Master: Receive completion message", msg);
            progresscount = msg.progresscount;
            if(conclude){
                the_message_handler = invalid_message_handler;
                done(progresscount);
            }else{
                conclude = true;
            }
        }
        cluster.once("message", handler);
        worker.send({reposname: reposname,
                    code: "fill_moredata",
                    slot: slot,
                    concurrency: concurrency,
                    count: count});
        cluster.once("exit", (w, code, signal) => {
            if(code != 0){
                err(new Error("Unexpected worker exit"));
            }else{
                if(conclude){
                    done(progresscount);
                }else{
                    conclude = true;
                }
            }
        })
    });
}

function proc_repository_moredata(reposname, slot){
    return new Promise((done, err) => {
        function itr(){
            proc_repository_moredata0(reposname, slot).then(cnt => {
                if(cnt != 0){
                    console.log("Master: Processed(retry)",cnt,reposname,slot);
                    itr();
                }else{
                    console.log("Master: Process(done)",reposname,slot);
                    done(0);
                }
            });
        }
        itr();
    });
}

function proc_repository_stags0(reposname){ // Promise
    const concurrency = 32;
    const count = 10000;

    return new Promise((done, err) => {
        const worker = cluster.fork();
        let conclude = false;
        let progresscount = -1;
        function handler(w, msg, handle){
            console.log("Master: Receive completion message", msg);
            progresscount = msg.progresscount;
            if(conclude){
                done(progresscount);
            }else{
                conclude = true;
            }
        }
        cluster.once("message", handler);
        worker.send({reposname: reposname,
                    code: "fill_stags",
                    concurrency: concurrency,
                    count: count});
        cluster.once("exit", (w, code, signal) => {
            if(code != 0){
                err(new Error("Unexpected worker exit"));
            }else{
                if(conclude){
                    done(progresscount);
                }else{
                    conclude = true;
                }
            }
        })
    });
}

function proc_repository_stags(reposname){
    return new Promise((done, err) => {
        function itr(){
            proc_repository_stags0(reposname).then(cnt => {
                if(cnt != 0){
                    console.log("Master: Stags Processed(retry)",cnt,reposname);
                    itr();
                }else{
                    console.log("Master: Stags Process(done)",reposname);
                    done(0);
                }
            });
        }
        itr();
    });
}

function proc_repository(reposname){ // Promise
    // fill_mainhistory => "parents" => (commit log info) => "pathops"
    return proc_repository_mainhistory(reposname).then(_ => {
        return proc_repository_moredata(reposname, "parents");
    }).then(_ => {
        return proc_repository_stags(reposname);
    }).then(_ => {
        return proc_repository_moredata(reposname, "pathops");
    });
}


if(cluster.isMaster){
    proc_repository("ruby").then(_ => {
        process.exit(0);
    });
}else{
    process.on("message", msg => {
        console.log("Worker: Starting",msg);
        switch(msg.code){
            case "fill_stags":
                do_fill_stags(msg);
                break;
            case "fill_mainhistory":
                do_fill_mainhistory(msg);
                break;
            case "fill_moredata":
                do_fill_moredata(msg);
                break;
            default:
                console.log("Worker: Invalid message\n", msg);
                process.exit(-1);
                break;
        }
    });
}
