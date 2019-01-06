const Git = require("nodegit");
const Queue = require("promise-queue");
const GitHelper = require("./githelper.js");
const DB = require("./dbhelper.js");
const fs = require("fs");

const PARENTS_VER = 1;
const PATHOPS_VER = 1;
const STAGS_VER = 1;

function enterchain(S, G, Xnew, Xupdate, reposname, colour, commit, dbg_name){
    let check_counter = 0;
    let set_counter = 0;
    function checkcount(){
        if((check_counter % 500) == 0){
            console.log("CHECK: ",dbg_name ,check_counter);
        }
        check_counter++;
    }

    function setcount(){
        if((set_counter % 500) == 0){
            console.log("SET: ",dbg_name,set_counter);
        }
        set_counter++;
    }
    function check(commit){
        return new Promise(res => {
            G(commit.sha()).then(x => {
                if(x){
                    console.log("TERM", commit.sha());
                    res(false);
                }else{
                    checkcount();
                    //console.log("CONT", commit.sha());
                    res(true);
                }
            });
        });
    }

    function dochain(commit){
        return new Promise(res => {
            entercommit(S, Xnew, Xupdate, reposname, colour, commit)
                .then(_ => {
                    setcount();
                    res(true);
                });
        });
    }

    return new Promise(res => {
        GitHelper.calcmainhistorychain(commit, check).then(chain => {
            const Q = new Queue(16, Infinity);
            return Promise
                .all(chain.map(e => Q.add(function(){return dochain(e);})));
        }).then(_ => {
            console.log("Done:",dbg_name,check_counter,set_counter);
            res(true);
        });
    });
}

function entercommit(S, Xnew, Xupdate, reposname, colour, commit){
    return new Promise((done, err) => {
        let shortcut = false;
        commit.getParents().then(parents => {
            if(parents.length <= 1){
                shortcut = true;
            }
            return S({
                     "repos":reposname,
                     "ident":commit.sha(),
                     "author":commit.author().toString(),
                     "date":commit.date(),
                     "message":commit.message(),
                     "parents":parents.map(c => c.sha()),
                     "colour":colour
            });
        }).then(_ => {
            return Xnew(reposname, commit.sha(), commit.date());
        }).then(_ => {
            if(shortcut){
                Xupdate(reposname, commit.sha(), "parents", PARENTS_VER)
                    .then(_ => {
                        done(1);
                    });
            }else{
                done(true);
            }
        }).catch(e => err(e));
    });
}

function enterpathpages(P, reposname, commit){
    return new Promise((done, err) => {
        const pagesize = 300;
        let oppages_count = 0;
        let oppages = [];
        GitHelper.getcommitops(commit).then(ops => {
            oppages_count = Math.ceil(ops.length / pagesize);
            for(let page = 0; page != oppages_count; page++){
                let end = Math.min((page+1) * pagesize, ops.length);
                let content = [];
                for(let idx = page * pagesize; idx != end; idx++){
                    content.push(ops[idx]);
                }
                oppages.push({
                             "reposname":reposname,
                             "ident":commit.sha(),
                             "page":page,
                             "ops":content});
            }
            if(ops.length == 0){
                return Promise.resolve([]);
            }else{
                return Promise.all(oppages.map(e => P(e)));
            }
        }).then(_ => done(true)).catch(e => err(e));
    });
}

function enterpathpages_ident(REPO, P, Xupdate, reposname, ident){
    return REPO.getCommit(ident).then(commit => {
        return enterpathpages(P, reposname, commit);
    }).then(_ => {
        return Xupdate(reposname, ident, "pathops", PATHOPS_VER);
    }).then(_ => Promise.resolve(1));
}

function enterchain_ident(REPO, S, G, Xnew, Xupdate, reposname, ident){
    return REPO.getCommit(ident).then(commit => {
        const colour = ident;
        return enterchain(S, G, Xnew, Xupdate, reposname, colour, commit,
                          reposname + " Commit " + ident);
    }).then(_ => {
        return Xupdate(reposname, ident, "parents", PARENTS_VER);
    }).then(_ => Promise.resolve(1));
}

function fill_stags(dburl, repospath, reposzone, reposname, tagger, starttime, limit, concurrency){
    // morecontext => {
    //   lastdate: Date,
    //   progresscount: count
    // }

    return new Promise((done, err) => {
        let G, S, P, Xenum, Xnew, Xupdate, REPO, Tnew;
        let lastdate = new Date(0);
        let progresscount = 0;
        let proc = false;
        let ver = STAGS_VER;

        function setcount(){
            if((progresscount % 500) == 0){
                console.log("STAGS SET: ", progresscount);
            }
            progresscount++;
        }

        DB.make_db_getter(dburl, reposzone, "refs").then(theGetter => {
            G = theGetter;
            return Promise.resolve(true);
        }).then(_ => {
            return DB.make_db_setter(dburl, reposzone, "stags");
        }).then(theSetter => {
            Tnew = theSetter;
            return DB.make_db_setter(dburl, reposzone, "refs");
        }).then(theSetter => {
            S = theSetter;
            return DB.make_db_setter(dburl, reposzone, "paths");
        }).then(theSetter => {
            P = theSetter;
            return DB.make_db_refstate_new(dburl, reposzone);
        }).then(theNew => {
            Xnew = theNew;
            return DB.make_db_refstate_update(dburl, reposzone);
        }).then(theUpdate => {
            Xupdate = theUpdate;
            return DB.make_db_refstate_enumtargets(dburl, reposzone);
        }).then(theEnum => {
            Xenum = theEnum;
            return Promise.resolve(true);
        }).then(_ => {
            return Git.Repository.open(repospath);
        }).then(repo => {
            REPO = repo;
            let qdate = starttime ? starttime : lastdate;

            proc = function(e){
                return function(){
                    return REPO.getCommit(e.ident).then(commit => {
                        let input = {
                            "message": commit.message(),
                            "author": commit.author().toString(),
                            "date": commit.date(),
                        };
                        let output = tagger(input);
                        let tags = output.map(x => {
                            x.repos = reposname;
                            x.ident = commit.sha();
                            x.date = commit.date();
                            return x;
                        });
                        return Promise.all(tags.map(e => Tnew(e)));
                    }).then(_ => {
                        setcount();
                        return Xupdate(reposname, e.ident, "stags", STAGS_VER);
                    });
                }
            }

            return Xenum(reposname, "stags", ver, qdate, limit);
        }).then(arr => {
            const Q = new Queue(concurrency, Infinity);
            let len = arr.length;
            console.log("STAGS PROC",len);
            return Promise.all(arr.map(e => Q.add(proc(e))));
        }).then(_ => {
            console.log("Done.");
            done({progresscount: progresscount});
        });
    });
}

function fill_moredata(dburl, repospath, reposzone, reposname, slot, starttime, limit, concurrency){
    // morecontext => {
    //   lastdate: Date,
    //   progresscount: count
    // }

    return new Promise((done, err) => {
        let G, S, P, Xenum, Xnew, Xupdate, REPO;
        let lastdate = new Date(0);
        let progresscount = 0;
        let proc = false;
        let ver = 0;

        function setcount(){
            if((progresscount % 500) == 0){
                console.log("SET: ",slot, progresscount);
            }
            progresscount++;
        }

        DB.make_db_getter(dburl, reposzone, "refs").then(theGetter => {
            G = theGetter;
            return Promise.resolve(true);
        }).then(_ => {
            return DB.make_db_setter(dburl, reposzone, "refs");
        }).then(theSetter => {
            S = theSetter;
            return DB.make_db_setter(dburl, reposzone, "paths");
        }).then(theSetter => {
            P = theSetter;
            return DB.make_db_refstate_new(dburl, reposzone);
        }).then(theNew => {
            Xnew = theNew;
            return DB.make_db_refstate_update(dburl, reposzone);
        }).then(theUpdate => {
            Xupdate = theUpdate;
            return DB.make_db_refstate_enumtargets(dburl, reposzone);
        }).then(theEnum => {
            Xenum = theEnum;
            return Promise.resolve(true);
        }).then(_ => {
            return Git.Repository.open(repospath);
        }).then(repo => {
            REPO = repo;
            let qdate = starttime ? starttime : lastdate;

            switch(slot){
                case "pathops":
                    ver = PATHOPS_VER;
                    proc = function(e){
                        return function(){
                            setcount();
                            return enterpathpages_ident(REPO, P, Xupdate,
                                                        reposname, e.ident);
                        }
                    };
                    break;
                case "parents":
                    ver = PARENTS_VER;
                    if(concurrency != 1){
                        return Promise.reject(new Error("parents: Concurrent op is not supported"));
                    }
                    proc = function(e){
                        return function(){
                            setcount();
                            return enterchain_ident(REPO, S, G, Xnew, Xupdate, 
                                                    reposname, e.ident);
                        }
                    };
                    break;
                default:
                    return Promise.reject(new Error("Unknown slot"));
            }

            return Xenum(reposname, slot, ver, qdate, limit);
        }).then(arr => {
            const Q = new Queue(concurrency, Infinity);
            let len = arr.length;
            console.log("PROC",slot,len);
            return Promise.all(arr.map(e => Q.add(proc(e))));
        }).then(_ => {
            console.log("Done.");
            done({progresscount: progresscount});
        });
    });
}

function fill_mainhistory(dburl, repospath, reposzone, reposname, options){
    return new Promise((done, err) => {
        let G, S, P, Xnew, Xupdate, REPO;
        let ref_regexp = options.ref_regexp ? options.ref_regexp : false;

        function procbranch(repo, ref){ // => Promise
            return new Promise(done => {
                const colour = ref.name();
                console.log("Procbranch:",colour, ref.target().tostrS());
                repo.getCommit(ref.target()).then(commit => {
                    enterchain(S, G, Xnew, Xupdate, reposname, colour, commit,
                                      ref.name()).then(_ => done(true));
                }).catch(e => {
                    // Allow tag resolution failure for now...
                    console.warn("catch",e);
                    done(false);
                });
            });
        }

        function headsmap(ref){
            return {
                repos: reposname,
                name: ref.name(),
                ref: ref.target().tostrS()
            };
        }

        function headfilter(ref){
            if(! ref_regexp){
                return true;
            }else{
                let n = ref_regexp.find(e => e.test(ref.name()));
                return n ? true : false;
            }
        }

        DB.make_db_getter(dburl, reposzone, "refs").then(theGetter => {
            G = theGetter;
            return Promise.resolve(true);
        }).then(_ => {
            return DB.make_db_setter(dburl, reposzone, "refs");
        }).then(theSetter => {
            S = theSetter;
            return DB.make_db_setter(dburl, reposzone, "paths");
        }).then(theSetter => {
            P = theSetter;
            return DB.make_db_refstate_new(dburl, reposzone);
        }).then(theNew => {
            Xnew = theNew;
            return DB.make_db_refstate_update(dburl, reposzone);
        }).then(theUpdate => {
            Xupdate = theUpdate;
            return Promise.resolve(true);
        }).then(_ => {
            return Git.Repository.open(repospath);
        }).then(repo => {
            REPO = repo;
            return repo.getReferences(Git.Reference.TYPE.LISTALL);
        }).then(arr0 => {
            const Q = new Queue(1, Infinity);
            let arr = arr0.filter(headfilter);
            return Promise.all(arr.map(e => Q.add(function(){return procbranch(REPO, e)}))).then(_ => {
                return DB.heads_set(dburl, reposzone, arr.map(headsmap));
            });
        }).then(_ => {
            console.log("Done.");
            done(true);
        });
    });
}

module.exports = {
    fill_stags:fill_stags,
    fill_moredata:fill_moredata,
    fill_mainhistory:fill_mainhistory
};
