const escapeRegExp = require("lodash.escaperegexp");

function make_gitsvn_tagger(config){
    const basepath = escapeRegExp(config.basepath);
    const uuid = escapeRegExp(config.uuid);
    const HEADER = escapeRegExp("git-svn-id: ");
    const id = config.id;
    const orig_basepath = config.basepath;
    const regexp = new RegExp(HEADER + basepath + "\\/([^@]+)@([0-9]+)");

    console.log("Regexp:", regexp);

    return function gitsvn_tagger(obj){
        const msg = obj.message;
        const arr = msg.match(regexp);
        if(arr){
            return [{
                type: "git-svn",
                uuid: uuid,
                id: id,
                basepath: orig_basepath,
                branch: arr[1],
                idx: arr[2]
            }];
        }else{
            return [];
        }
    }
}

function make_generic_tagger(config){
    let str = escapeRegExp(config.pattern);
    let has_idx = false;
    const maybe_idx_location = str.match(/NNNNN/); // FIXME: Use .test
    const id = config.id;
    let regexp = false;
    if(maybe_idx_location){
        has_idx = true;
        str = str.replace("NNNNN", "([0-9]+)");
        console.log("REPS",str);
    }
    if(has_idx){
        return function generig_tagger_idx(obj){
            const msg = obj.message;
            regexp = new RegExp(str, "g");
            let res = [];
            while((arr = regexp.exec(msg)) !== null){
                res.push({
                         type: "tag",
                         id: id,
                         idx: arr[1]
                });
            }
            /*
            res.forEach(e => {
                console.log("TAG",e);
            });
            */
            return res;
        };
    }else{
        return function generic_tagger(obj){
            const msg = obj.message;
            regexp = new RegExp(str, "g");
            let res = [];
            while((arr = regexp.exec(msg)) !== null){
                res.push({
                         type: "tag",
                         id: id,
                         idx: false,
                });
            }
            return res;
        }
    }
}

function make_tagger(arr){
    const taggers = arr.map(e => {
        const myname = Object.keys(e)[0];
        const options = e[myname];
        if(! options.id){
            options.id = myname;
        }
        console.log(options);
        switch(options.type){
            case "git-svn":
                return make_gitsvn_tagger(options);
            case "tag":
                return make_generic_tagger(options);
            default:
                throw new Error("Huh?");
        }
    });

    return function the_tagger(obj){
        let res = [];
        //console.log("TAG:",obj);
        taggers.forEach(tagger => {
            res = res.concat(tagger(obj));
        });
        /*
        res.forEach(e => {
            console.log("RES:",e);
        });
        */
        return res;
    }
}

module.exports = {
    make_tagger:make_tagger
}
