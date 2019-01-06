const escapeRegExp = require("lodash.escaperegexp");
const MongoClient = require("mongodb").MongoClient;

function resetdb0(url, name){
    const client = new MongoClient(url,{useNewUrlParser:true});
    return new Promise((done,err) => {
        client.connect().then(client => {
            client.db().dropCollection(name).then(C => {
                client.close();
                done(true);
            }).catch(x => {
                console.log("error (ignored)",x); 
                client.close();
                done(x);
            });
        });
    });
}

function resetdb(url, name){
    const refsname = name + "_refs";
    const headsname = name + "_heads";
    const statename = name + "_states";
    const pathsname = name + "_paths";
    const stagsname = name + "_stags";
    const client = new MongoClient(url,{useNewUrlParser:true});

    return Promise.all([
        resetdb0(url, refsname),
        resetdb0(url, statename),
        resetdb0(url, headsname),
        resetdb0(url, pathsname),
        resetdb0(url, stagsname)
    ]).then(x => {
        return client.connect().then(client => {
            const refscol = client.db().collection(refsname);
            const headscol = client.db().collection(headsname);
            const pathscol = client.db().collection(pathsname);
            const statescol = client.db().collection(statename);
            const stagscol = client.db().collection(statename);

            return refscol.createIndex({ident: 1}, {unique: true}
            ).then(_ => refscol.createIndex({"repos":1, "ident": 1})
            ).then(_ => refscol.createIndex({"repos":1, "colour": 1})
            ).then(_ => refscol.createIndex({"message":"text"})
            ).then(_ => refscol.createIndex({"author": 1})
            ).then(_ => 
                   headscol.insertOne({"theHead":"theHead","theHeads":[]})
            ).then(_ =>
                   pathscol.createIndex({"ident": 1})
            ).then(_ =>
                   pathscol.createIndex({"repos":1, "ident": 1})
            ).then(_ =>
                   pathscol.createIndex({"ops.from_oid":1})
            ).then(_ =>
                   pathscol.createIndex({"ops.to_oid":1})
            ).then(_ =>
                   pathscol.createIndex({"ops.from": "text", "ops.to": "text"})
            ).then(_ =>
                   statescol.createIndex({"date": 1})
            ).then(_ =>
                   statescol.createIndex({"ident": 1})
            ).then(_ =>
                   statescol.createIndex({"repos":1, "ident": 1})
            ).then(_ =>
                   statescol.createIndex({"states.type": 1,
                                         "states.ver": 1},
                                         {partialFilterExpression:
                                             {"states.type": {$exists:true}}})
            ).then(_ =>
                   stagscol.createIndex({"repos":1, "ident": 1})
            ).then(_ =>
                   stagscol.createIndex({"repos":1, "type":1})
            ).then(_ =>
                   stagscol.createIndex({"idx":1})
            ).then(_ =>
                   stagscol.createIndex({"date":1})
            ).then(_ => client.close());
        });
    });
}

// Generic queries
function make_db_getheads(url, zonename){
    // FIXME: Implement zones
    const headsname = zonename + "_heads";
    const mongo = new MongoClient(url,{useNewUrlParser:true});
    return new Promise((done, err) => {
        mongo.connect().then(client => {
            const heads = client.db().collection(headsname);
            function getheads(reposname){
                return new Promise((done, err) => {
                    heads.find({theHead:"theHead"}).toArray().then(arr => {
                        if(arr && arr.length == 1){
                            done(arr[0].theHeads);
                        }else{
                            if(arr){
                                console.log("something wrong", arr);
                                err(true);
                            }else{
                                done(false);
                            }
                        }
                    });
                });
            }
            done(getheads);
        });
    });
}

function make_db_search(url, zonename){
    const refsname = zonename + "_refs";
    const stagsname = zonename + "_stags";
    const mongo = new MongoClient(url,{useNewUrlParser:true});
    return new Promise((done, err) => {
        mongo.connect().then(client => {
            const refs = client.db().collection(refsname);
            const stags = client.db().collection(stagsname);
            function strmatch(string){
                return {$regex: escapeRegExp(string), $options: "i"};
            }
            function error(code){
                return {error: code};
            }
            function search_author(reposname, strings){
                return new Promise(done => {
                    const q = {
                        repos: reposname,
                        author: {$or: strings.map(strmatch)}
                    };
                    refs.aggregate([{$match: q},
                        // FIXME: $group usage
                        {$group: {_id:"$author"}}])
                    .toArray().then(arr => {
                        done({result: arr.map(e => e._id)});
                    });
                });
            }
            function search_history(reposname, query, from, count){
                // query.authors = [ string ... ]
                // query.strings = [ string ... ] 
                // query.tag[] = { name: "tagname",
                //                 string: [ ... ] }
                // query.index[] = { name: "tagname",
                //                   index_start: NUMBER_OPTIONAL,
                //                   index_end: NUMBER_OPTIONAL,
                //                   index: [ ... ] }
                return new Promise(done => {
                    done({result: []});
                });
            }

            function search(reposname, query, from, count){
                // query.mode = "author" | "history"
                switch(query.mode){
                    case "author":
                        return search_author(reposname, query.strings)
                    case "history":
                        delete query.mode;
                        return search_history(reposname, query, from, count);
                    default:
                        return Promise.resolve(error("unknown mode"));
                }
            }
            done(search);
        });
    });
}

function make_db_queryhistory(url, zonename){
    const refsname = zonename + "_refs";
    const mongo = new MongoClient(url,{useNewUrlParser:true});
    return new Promise((done, err) => {
        mongo.connect().then(client => {
            const refs = client.db().collection(refsname);
            function queryhistory(reposname, from, count){
                return new Promise(done => {
                    const query0 = {
                        repos: reposname,
                        ident: from  
                    }
                    refs.findOne(query0).then(first => {
                        const colour = first.colour;
                        const time = first.date;
                        const q1 = {
                            repos: reposname,
                            date: {$eq: time},
                            colour: colour
                        };
                        const q2 = {
                            repos: reposname,
                            date: {$gt: time},
                            colour: colour
                        };
                        const opt2 = { 
                            sort: {date: -1}, 
                            limit: count
                        };
                        Promise.all([refs.find(q1).toArray(),
                            refs.find(q2).toArray()]).then(arr => {
                                const a1 = arr[0];
                                const a2 = arr[1];
                                done(a1.concat(a2).map(e => {
                                    return e.ident;
                                }));
                            });
                    });
                });
            }
            done(queryhistory);
        });
    });
}

function make_db_queryrev(url, zonename){
    const refsname = zonename + "_refs";
    const stagsname = zonename + "_stags";
    const mongo = new MongoClient(url,{useNewUrlParser:true});
    return new Promise((done, err) => {
        mongo.connect().then(client => {
            // FIXME: Rewrite with Aggregation
            const refs = client.db().collection(refsname);
            const stags = client.db().collection(stagsname);
            function queryrev(reposname, idents){
                return new Promise((done, err) => {
                    let res = {};
                    const query = {
                        repos: reposname,
                        ident: {$in: idents},
                    };
                    Promise.all([refs.find(query).toArray(),
                        stags.find(query).toArray()]).then(arr => {
                            const tags_arr = arr[1];
                            let revs = arr[0];
                            let tags = {};
                            tags_arr.forEach(e => {
                                let set = e;
                                let ident = e.ident;
                                let repos = e.repos;
                                delete set.ident;
                                delete set.repos;
                                if(tags[ident]){
                                    tags[ident].push(set);
                                }else{
                                    tags[ident] = [set];
                                }
                            });
                            done(revs.map(e => {
                                if(tags[e.ident]){
                                    e.tags = tags[e.ident];
                                }
                                return e;
                            }));
                        });
                });
            }
            done(queryrev);
        });
    });
}

function make_db_querypathop(url, zonename){
    const pathsname = zonename + "_paths";
    const mongo = new MongoClient(url,{useNewUrlParser:true});
    return new Promise((done, err) => {
        mongo.connect().then(client => {
            // FIXME: Rewrite with Aggregation
            const paths = client.db().collection(pathsname);
            function querypathop(reposname, ident, pagestart, count){
                return new Promise((done, err) => {
                    let res = {};
                    const query = {
                        repos: reposname,
                        ident: ident,
                        page: {$gte: pagestart}
                    };
                    paths.find(query).sort({page: 1}).limit(count)
                    .toArray().then(arr => {
                        done(arr);
                    });
                });
            }
            done(querypathop);
        });
    });
}

function make_db_setter(url, zonename, name){
    const colname = zonename + "_" + name;
    const client = new MongoClient(url,{useNewUrlParser:true});

    return new Promise((done, err) => {
        client.connect().then(client => {
            const col = client.db().collection(colname);
            function setter(obj){
                if(obj){
                    return col.insertOne(obj);
                }else{
                    return client.close();
                }
            }
            done(setter);
        }).catch(e => err(e));
    });
}

function make_db_getter(url, zonename, name){
    const refsname = zonename + "_" + name;
    const client = new MongoClient(url,{useNewUrlParser:true});
    return new Promise((done, err) => {
        client.connect().then(client => {
            const col = client.db().collection(refsname);
            function getter(ident){
                //console.log("Get", ident);
                if(ident){
                    return new Promise((done, err) => {
                        //console.log("Find", ident);
                        col.find({ident: ident}).toArray().then(arr => {
                            if(arr && arr.length == 1){
                                done(arr[0]);
                            }else{
                                if(arr.length != 0){
                                    console.log("Something wrong", arr);
                                    err(true);
                                }else{
                                    done(false);
                                }
                            }
                        });
                    });
                }else{
                    return client.close();
                }
            }
            done(getter);
        }).catch(e => err(e));
    });
}

/*
 * refstate handling
 *
 * { ident: "ident", date: NUMBER, states: [ STATES ... ] }
 */

function make_db_refstate_new(url, zonename){
    const targetname = zonename + "_states";
    const client = new MongoClient(url,{useNewUrlParser:true});
    return new Promise((done, err) => {
        client.connect().then(client => {
            const col = client.db().collection(targetname);
            function newref(reposname, ident, date){
                return new Promise(done => {
                    const doc = {
                        repos: reposname,
                        ident: ident,
                        date: date,
                        states: []
                    };
                    col.insertOne(doc).then(_ => {
                        done(true);
                    })
                });
            }
            done(newref);
        }).catch(e => err(e));

    });
}

function make_db_refstate_update(url, zonename){
    const targetname = zonename + "_states";
    const client = new MongoClient(url,{useNewUrlParser:true});
    return new Promise((done, err) => {
        client.connect().then(client => {
            const col = client.db().collection(targetname);
            function updateref(reposname, ident, type, ver){
                return new Promise(done => {
                    const q = {
                        repos: reposname,
                        ident: ident
                    };
                    col.findOneAndUpdate(q, {
                        $push: { states: {type: type, ver: ver}}
                    }).then(res => done(res));
                });
            }
            done(updateref);
        }).catch(e => err(e));
    });
}

function make_db_refstate_enumtargets(url, zonename){
    const targetname = zonename + "_states";
    const client = new MongoClient(url,{useNewUrlParser:true});

    return new Promise((done, err) => {
        client.connect().then(client => {
            const col = client.db().collection(targetname);
            function enumtargets(reposname, type, ver, time, count){
                /* Returns =time AND >time upto count 
                 * (NB: Might return objs more than count) */

                const q1 = {
                    repos: reposname,
                    date: {$eq: time},
                    states: {$not: {$elemMatch: {type: type, ver: ver}}}
                };
                const q2 = {
                    repos: reposname,
                    date: {$gt: time},
                    states: {$not: {$elemMatch: {type: type, ver: ver}}}
                }
                return new Promise(res => {
                    let r1 = [];
                    let r2 = [];
                    col.find(q1).toArray().then(res1 => {
                        r1 = res1;
                        return col.find(q2,{ sort: {date: 1}, limit: count}).toArray();
                    }).then(res2 => {
                        r2 = res2;
                        res(r1.concat(r2));
                    });
                });
            }
            done(enumtargets);
        }).catch(e => err(e));
    });
}

function heads_set(url, name, obj){
    const headsname = name + "_heads";
    const client = new MongoClient(url,{useNewUrlParser:true});
    return client.connect().then(client => {
        return client.db().collection(headsname)
            .findOneAndReplace({theHead:"theHead"},
                               {theHead:"theHead", theHeads:obj});
    });
}

function heads_get(url, name){
    const headsname = name + "_heads";
    const client = new MongoClient(url,{useNewUrlParser:true});
    return new Promise((done, err) => {
        client.connect().then(client => {
            return client.db().collection(headsname);
        }).then(col => {
            col.find({theHead:"theHead"}).toArray().then(arr => {
                if(arr && arr.length == 1){
                    done(arr[0]);
                }else{
                    if(arr){
                        console.log("something wrong", arr);
                        err(true);
                    }else{
                        done(false);
                    }
                }
            });
        });
    });
}

module.exports = {
    resetdb:resetdb,
    make_db_setter:make_db_setter,
    make_db_getter:make_db_getter,
    make_db_search:make_db_search,
    make_db_getheads:make_db_getheads,
    make_db_queryhistory:make_db_queryhistory,
    make_db_queryrev:make_db_queryrev,
    make_db_querypathop:make_db_querypathop,
    make_db_refstate_new:make_db_refstate_new,
    make_db_refstate_update:make_db_refstate_update,
    make_db_refstate_enumtargets:make_db_refstate_enumtargets,
    heads_set:heads_set,
    heads_get:heads_get
};
