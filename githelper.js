const Git = require("nodegit");

function calcmainhistorychain(commit, cb){
    // cb := Promise(commit => boolean, false to terminate)

    var cur = commit;
    var ret = [];

    return new Promise(done => {
        function next(){
            cur.getParents().then(arr => {
                if(arr && arr[0]){
                    cb(arr[0]).then(check => {
                        if(check){
                            ret.push(arr[0]);
                            cur = arr[0];
                            next();
                        }else{
                            console.log("DONE1");
                            done(ret);
                        }
                    });
                }else{
                    console.log("DONE2");
                    done(ret);
                }
            });
        };

        next();
    });
}

function getcommitops(commit){
    const ident = commit.sha();
    return new Promise((done,err) => {
        /* FIXME: Use single tree-to-tree diff to optimize merge diffs */
        commit.getDiff().then(arr => {
            if(arr && arr[0]){
                const theDiff = arr[0];

                var all,n,i;
                all = [];
                n = theDiff.numDeltas();
                for(i=0;i!=n;i++){ /* FIXME: ??? */
                    all.push(theDiff.getDelta(i));
                }
                const ret = all.map(e => {
                    var op;
                    const from = e.oldFile().path();
                    const to = e.newFile().path();
                    const from_oid = e.oldFile().id().tostrS();
                    const to_oid = e.newFile().id().tostrS();
                    switch(e.status()){
                        case Git.Diff.DELTA.ADDED:
                            op = "add";
                            break;
                        case Git.Diff.DELTA.DELETED:
                            op = "del";
                            break;
                        case Git.Diff.DELTA.MODIFIED:
                            op = "mod";
                            break;
                        case Git.Diff.DELTA.RENAMED:
                            op = "move";
                            break;
                        case Git.Diff.DELTA.COPIED:
                            op = "copy";
                            break;
                        default:
                            op = e.status();
                            break;
                    }
                    return {
                        "op": op,
                        "from": from,
                        "from_oid": from_oid,
                        "to": to,
                        "to_oid": to_oid,
                    };
                });
                done(ret);
            }else{
                err("???");
            }
        });

    });
}

function getmainhistory(commit, count){
    /* NB: revwalk is your friend */
    var cur = commit;
    var ret = [];

    ret.push([cur]);

    return new Promise(done => {
        function next(){
            if(count == 0){
                done(ret);
            }else{
                cur.getParents().then(arr => {
                    if(arr && arr[0]){
                        ret.push(arr);
                        count--;
                        cur = arr[0];
                        next();
                    }else{
                        done(ret);
                    }
                });
            }
        };

        next();
    });
};

module.exports = {
    calcmainhistorychain:calcmainhistorychain,
    getcommitops:getcommitops,
    getmainhistory:getmainhistory
};
