const miijs = require("miijs");
const fetch = require("@replit/node-fetch");
const crypto = require('crypto');
const fs = require("fs");
const ejs = require('ejs');
const express = require("express");
const path = require("path");
const storage = require("./storage.json");
const nodemailer = require("nodemailer");
const cookieParser = require('cookie-parser');
var multer = require('multer');
var upload = multer({ dest: 'uploads/' });
var globalSalt = process.env.salt;
process.env=require("./env.json");

var partials={};
fs.readdirSync("./partials").forEach(file=>{
    if(!file.endsWith(".html")) return;
    partials[file.split(".")[0]]=fs.readFileSync(`./partials/${file}`,"utf-8");
});
function getSendables(req){
    //EJS renders server side, only what we render in the file gets sent, so having storage readily available is much easier and not a problem for security
    var send=Object.assign(structuredClone(storage),{ thisUser: req.cookies.username||"Default", pfp: storage.users[req.cookies.username||"Default"].miiPfp, query:req.query});
    send.partials=structuredClone(partials);
    fs.readdirSync(`./ejsPartials`).forEach(file=>{
        if(!file.endsWith(".ejs")) return;
        ejs.renderFile(`./ejsPartials/${file}`, send, {}, function(err, str) {
            if (err) {
                return;
            }
            send.partials[file.split(".")[0]]=str;
        });
    });
    return send;
}

// Role System - Array-based for multiple roles
const ROLES = {
    TEMP_BANNED: 'tempBanned',
    PERM_BANNED: 'permBanned', 
    BASIC: 'basic',
    SUPPORTER: 'supporter',
    RESEARCHER: 'researcher',
    MODERATOR: 'moderator',
    ADMINISTRATOR: 'administrator'
};

const ROLE_DISPLAY = {
    [ROLES.TEMP_BANNED]: '🚫 Temporarily Banned',
    [ROLES.PERM_BANNED]: '⛔ Permanently Banned',
    [ROLES.BASIC]: 'User',
    [ROLES.SUPPORTER]: '💖 Supporter',
    [ROLES.RESEARCHER]: '🔬 Researcher',
    [ROLES.MODERATOR]: '🛡️ Moderator',
    [ROLES.ADMINISTRATOR]: '👑 Administrator'
};

// Helper functions for role system
function getUserRoles(user) {
    if (Array.isArray(user.roles)) {
        return user.roles;
    }
    return [ROLES.BASIC];
}

function hasRole(user, role) {
    const roles = getUserRoles(user);
    return roles.includes(role);
}

function canUploadOfficial(user) {
    return hasRole(user, ROLES.RESEARCHER) || 
           hasRole(user, ROLES.ADMINISTRATOR);
}

function canModerate(user) {
    return hasRole(user, ROLES.MODERATOR) || 
           hasRole(user, ROLES.ADMINISTRATOR);
}

function isAdmin(user) {
    return hasRole(user, ROLES.ADMINISTRATOR);
}

function isBanned(user) {
    const roles = getUserRoles(user);
    if (roles.includes(ROLES.PERM_BANNED)) return true;
    if (roles.includes(ROLES.TEMP_BANNED)) {
        if (user.banExpires && Date.now() < user.banExpires) {
            return true;
        }
        else if (user.banExpires) {
            // Unban user - remove temp ban role
            user.roles = user.roles.filter(r => r !== ROLES.TEMP_BANNED);
            delete user.banExpires;
            save();
            return false;
        }
        return true;
    }
    return false;
}

function addRole(user, role) {
    if (!user.roles) {
        user.roles = [ROLES.BASIC];
    }
    if (!user.roles.includes(role)) {
        user.roles.push(role);
    }
    // Update legacy moderator flag
    user.roles.includes('moderator') = canModerate(user);
}

function removeRole(user, role) {
    if (!user.roles) {
        user.roles = [ROLES.BASIC];
    }
    user.roles = user.roles.filter(r => r !== role);
    if (user.roles.length === 0) {
        user.roles = [ROLES.BASIC];
    }
    // Update legacy moderator flag
    user.roles.includes('moderator') = canModerate(user);
}

function hashIP(ip) {
    return crypto.createHash('sha256').update(ip + globalSalt).digest('hex');
}

function isVPN(ip) {
    // Basic check - you might want to use a VPN detection API
    // For now, just check if it's a common VPN pattern
    // This is a placeholder - implement proper VPN detection if needed
    return false; // TODO: Implement VPN detection
}

function objCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
}
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function validate(what) {
    return /^(\d|\D){1,15}$/.test(what);
}

function save() {
    fs.writeFileSync("./storage.json", JSON.stringify(storage));
}

//Possibly able to generate 9 Billion IDs before needing a new character, which I doubt we'll ever hit
function genId() {
    let ret = "";
    let chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    while (storage.miiIds.includes(ret) || ret === "") {
        ret = "";
        for (var i = 0; i < 5; i++) {
            ret += chars[Math.floor(Math.random() * chars.length)];
        }
    }
    return ret;
}

function wilsonMethod(upvotes, uploadedOn) {
    // Constants for the Wilson Score Interval
    const z = 1.96; // 95% confidence interval
    
    // Calculate the fraction of upvotes
    const p = upvotes / (upvotes + 1); // Adding 1 to avoid division by zero
    
    // Calculate the "score"
    const score =
    (p + (z * z) / (2 * (upvotes + 1)) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * (upvotes + 1))) / (upvotes + 1))) /
    (1 + (z * z) / (upvotes + 1));
    
    // Calculate the hotness by considering the time elapsed
    const elapsedTime = (Date.now() - uploadedOn) / (1000 * 60 * 60); // Convert milliseconds to hours
    const hotness = score / elapsedTime;
    
    return hotness;
}
function api(what,limit=50,begin=0,fltr){
    var returnableMiis=structuredClone(storage.miis);
    delete returnableMiis.average;
    var newArr;
    switch(what){
        case "all":
            return returnableMiis;
        break;
        case "highlightedMii":
            return returnableMiis[storage.highlightedMii];
        break;
        case "getMii":
            return returnableMiis[fltr];
        break;
        case "random":
            newArr = shuffleArray(Object.values(returnableMiis));
        break;
        case "top":
            newArr = Object.values(returnableMiis);
            newArr.sort((a, b) => {
                return wilsonMethod(b.votes, b.uploadedOn) - wilsonMethod(a.votes, a.uploadedOn);
            });
        break;
        case "best":
            newArr = Object.values(returnableMiis);
            newArr.sort((a, b) => {
                return b.votes - a.votes;
            });
        break;
        case "recent":
            newArr=Object.values(returnableMiis);
            newArr.sort((a, b) => {
                return b.uploadedOn - a.uploadedOn;
            });
        break;
        case "official":
            newArr = Object.values(returnableMiis).filter(mii=>{
                return mii.official;
            });
            newArr.sort((a, b) => {
                return b.votes - a.votes;
            });
        break;
        case "search":
            fltr = fltr.toLowerCase();
            newArr = Object.values(returnableMiis).filter(mii=>{
                return mii.meta.name.toLowerCase().includes(fltr)||mii.desc.toLowerCase().includes(fltr)||mii.uploader.toLowerCase().includes(fltr);
            });
            //Needs to sort by relevancy at some point
            newArr.sort((a, b) => {
                return b.votes - a.votes;
            });
        break;
        default:
            return `{"okay":false,"error":"No valid type specified"}`
        break;
    }
    return newArr.slice(begin,limit);
}

function hashPassword(password, s) {
    let salt;
    if (s) {
        salt = s;
    }
    else {
        salt = crypto.randomBytes(16).toString('hex');
    }
    const hash = crypto.pbkdf2Sync(password, salt + globalSalt, 1000, 64, 'sha256').toString('hex');
    return { salt, hash };
}
function validatePassword(password, salt, hash) {
    return hashPassword(password, salt).hash === hash;
}
function genToken() {
    let ret = "";
    let chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < 15; i++) {
        ret += chars[Math.floor(Math.random() * chars.length)];
    }
    return ret;
}

function sendEmail(to, subj, cont) {
    nodemailer.createTransport({
        host: 'smtp.zoho.com',
        port: 465,
        secure: true,
        auth: {
            user: process.env.email,
            pass: process.env.emailPass
        }
    }).sendMail({
        from: process.env.email,
        to: to,
        subject: subj,
        html: cont
    });
}
function makeReport(cont) {
    fetch(process.env["hookUrl"], {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: cont,
    });
}


//Averaging Helpers
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function mean(nums) {
    if (!nums.length) return undefined;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function mode(arr) {
    const counts = new Map();
    const firstIndex = new Map();
    let best, bestCount = -1;
    arr.forEach((v, i) => {
        const c = (counts.get(v) ?? 0) + 1;
        counts.set(v, c);
        if (!firstIndex.has(v)) firstIndex.set(v, i);
        if (c > bestCount || (c === bestCount && firstIndex.get(v) < firstIndex.get(best))) {
            best = v; bestCount = c;
        }
    });
    return best;
}
function getNestedAsArrays(obj) {
    const ret = {};
    for (const [key, val] of Object.entries(obj)) {
        if (isPlainObject(val)) {
            ret[key] = getNestedAsArrays(val);
        }
        else {
            ret[key] = [val];
        }
    }
    return ret;
}
function populateNestedArrays(arrayObj, obj) {
    const ret = structuredClone(arrayObj);
    for (const [key, val] of Object.entries(obj)) {
        if (isPlainObject(val)) {
            if (!ret[key] || !isPlainObject(ret[key])) ret[key] = {};
            ret[key] = populateNestedArrays(ret[key], val);
        }
        else {
            if (!Array.isArray(ret[key])) ret[key] = [];
            ret[key].push(val);
        }
    }
    return ret;
}
function getCollectedLeavesAcrossMiis() {
    let acc;
    for (const mii of Object.values(storage.miis)) {
        acc = acc ? populateNestedArrays(acc, mii) : getNestedAsArrays(mii);
    }
    return acc;
}
function mostCommonPageTypePair(pageArr, typeArr) {
    if (!Array.isArray(pageArr) || !Array.isArray(typeArr)) return null;
    const n = Math.min(pageArr.length, typeArr.length);
    const key = (p, t) => JSON.stringify([p, t]);
    const counts = new Map();
    const order = new Map();
    let bestKey, bestCount = -1;
    
    for (let i = 0; i < n; i++) {
        const p = pageArr[i], t = typeArr[i];
        if (p === undefined || p === null || t === undefined || t === null) continue;
        const k = key(p, t);
        const c = (counts.get(k) ?? 0) + 1;
        counts.set(k, c);
        if (!order.has(k)) order.set(k, i);
        if (c > bestCount || (c === bestCount && order.get(k) < order.get(bestKey))) {
            bestKey = k; bestCount = c;
        }
    }
    return bestKey ? JSON.parse(bestKey) : null; // [page, type]
}
function averageValuesForKey(key, values) {
    const vals = values.filter(v => v !== undefined && v !== null);
    if (!vals.length) return undefined;

    if (key==="type" || key==="color") {
        return mode(vals);
    }
    
    const allNumbers   = vals.every(v => typeof v === "number" && Number.isFinite(v));
    const allBooleans  = vals.every(v => typeof v === "boolean");
    const allStrings   = vals.every(v => typeof v === "string");
    const onlyNumOrBool = vals.every(v => typeof v === "number" || typeof v === "boolean");
    
    if (allNumbers) return Math.round(mean(vals));
    if (allBooleans) {
        const trues = vals.filter(Boolean).length;
        return trues >= (vals.length - trues); // modal boolean
    }
    if (onlyNumOrBool) {
        // booleans as 1/0, rounded mean
        const asNums = vals.map(v => (typeof v === "boolean" ? (v ? 1 : 0) : v));
        return Math.round(mean(asNums));
    }
    if (allStrings) return mode(vals);
    
    // Heterogeneous fallback → mode
    return mode(vals);
}
function averageObjectWithPairs(node, parentKey = "") {
    // Leaf arrays
    if (Array.isArray(node)) {
        return averageValuesForKey(parentKey, node);
    }
    
    // Non-object leaves
    if (!isPlainObject(node)) return node;
    
    // Special handling: resolve modal (page,type) pair if both are present as leaves/arrays
    const hasPage = Object.prototype.hasOwnProperty.call(node, "page");
    const hasType = Object.prototype.hasOwnProperty.call(node, "type");
    const pageIsLeaf = hasPage && !isPlainObject(node.page);
    const typeIsLeaf = hasType && !isPlainObject(node.type);
    
    const out = {};
    
    if (hasPage && hasType && pageIsLeaf && typeIsLeaf) {
        const pageArr = Array.isArray(node.page) ? node.page : [node.page];
        const typeArr = Array.isArray(node.type) ? node.type : [node.type];
        
        const pair = mostCommonPageTypePair(pageArr, typeArr);
        if (pair) {
            const [bestPage, bestType] = pair;
            out.page = bestPage;
            out.type = bestType;
        }
        else {
            // Fallbacks if no pair resolved
            out.page = averageValuesForKey("page", pageArr);
            out.type = averageValuesForKey("type", typeArr);
        }
        
        // Process any siblings at this level
        for (const [k, v] of Object.entries(node)) {
            if (k === "page" || k === "type") continue;
            out[k] = averageObjectWithPairs(v, k);
        }
        return out;
    }
    
    // General case: recurse
    for (const [k, v] of Object.entries(node)) {
        out[k] = averageObjectWithPairs(v, k);
    }
    return out;
}
function getAverageMii(){
    var avg=averageObjectWithPairs(getCollectedLeavesAcrossMiis());
    avg.id = "average";
    avg.meta = { name: `J${avg.general.gender===0?"ohn":"ane"} Doe`, creatorName: "InfiniMii", type:"3ds" };
    avg.desc="The most common or average features and placements of those features across all Miis on the website";
    avg.uploader = "Everyone";
    avg.votes = 0;
    avg.uploadedOn = Date.now();
    storage.miis.average = avg;
}


const site = new express();
site.use(express.json());
site.use(express.urlencoded({ extended: true }));
site.use(express.static(path.join(__dirname + '/static')));
site.use(cookieParser());
site.use('/favicon.ico', express.static('static/favicon.png'));
site.use((req, res, next) => {
    // Check if user is banned
    if (req.cookies.username && storage.users[req.cookies.username]) {
        const user = storage.users[req.cookies.username];
        
        // Check IP ban
        const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const ipHash = hashIP(clientIP);
        if (storage.bannedIPs.includes(ipHash)) {
            res.clearCookie('username');
            res.clearCookie('token');
            return res.send('Your IP address has been permanently banned.');
        }
        
        // Check user ban
        if (isBanned(user)) {
            // Allow access to logout only
            if (req.path === '/logout') {
                return next();
            }
            
            if (user.role === ROLES.TEMP_BANNED && user.banExpires) {
                const timeLeft = Math.ceil((user.banExpires - Date.now()) / (1000 * 60 * 60));
                return res.send(`You are temporarily banned. Time remaining: ${timeLeft} hours. Reason: ${user.banReason || 'No reason provided'}`);
            }
            else {
                return res.send(`You are permanently banned. Reason: ${user.banReason || 'No reason provided'}`);
            }
        }
    }
    next();
});

site.listen(8080, async () => {
    // - All actions here should be finished before we say Online, so as to help limit chances for data corruption, so tasks will be made synchronous even where they need not be -
    console.log("Starting, do not stop...");
    
    // For Quickly Uploading Batches of Miis
    await Promise.all(
        fs.readdirSync("./quickUploads").map(async (file) => {
            let mii;
            switch (file.split(".").pop().toLowerCase()) {
                case "mii":
                    mii = await miijs.convertMii(await miijs.readWiiBin(`./quickUploads/${file}`));
                break;
                case "png"://Do the same as JPG
                case "jpg":
                    mii = await miijs.read3DSQR(`./quickUploads/${file}`);
                break;
                case "txt"://Don't go to default handler, but don't do anything
                return;
                default:
                    fs.unlinkSync(`./quickUploads/${file}`);
                return;
            }
            
            if (!mii) {
                console.warn(`Couldn't read ${file}`);
                fs.unlinkSync(`./quickUploads/${file}`);
                return;
            }
            
            mii.uploadedOn = Date.now();
            mii.uploader = fs.readFileSync("./quickUploads/uploader.txt", "utf-8");
            mii.official = mii.uploader === "Nintendo";
            mii.votes = 1;
            mii.id = genId();
            mii.desc = "Uploaded in Bulk";
            
            storage.miis[mii.id] = mii;
            storage.miiIds.push(mii.id);
            (storage.users[mii.uploader] ??= { submissions: [] }).submissions.push(mii.id);
            
            fs.unlinkSync(`./quickUploads/${file}`);
            console.log(`Added ${mii.meta.name} from quick uploads`);
        })
    );
    console.log("Finished Checking Quick Uploads Folder");
    
    // For ensuring QRs are readable
    await Promise.all(
        fs.readdirSync("./static/miiQRs").map(async (file) => {
            try {
                if (!fs.existsSync(`./static/miiQRs/${file}`)) return;
                const mii = await miijs.read3DSQR(`./static/miiQRs/${file}`);
                if (!mii?.meta?.name) {
                    fs.unlinkSync(`./static/miiQRs/${file}`);
                }
            }
            catch (e) {
                fs.unlinkSync(`./static/miiQRs/${file}`);
            }
        })
    );
    console.log("Ensured QRs Are Readable For All Miis");
    
    // Make sure QRs and Thumbnails exist
    await Promise.all(
        Object.keys(storage.miis).map(async (miiKey) => {
            const mii = storage.miis[miiKey];
            
            if (!fs.existsSync(`./static/miiImgs/${mii.id}.jpg`)) {
                fs.writeFileSync(`./static/miiImgs/${mii.id}.jpg`, await miijs.renderMii(mii));
                console.log(`Making image for ${mii.id}`);
            }
            
            if (!fs.existsSync(`./static/miiQRs/${mii.id}.jpg`)) {
                // If write3DSQR is async in your lib, add `await` here.
                miijs.write3DSQR(mii, `./static/miiQRs/${mii.id}.jpg`);
                console.log(`Making QR for ${mii.id}`);
            }
        })
    );
    console.log(`Ensured All Miis Have QRs And Face Renders\nGenerating new average Mii...`);
    getAverageMii();
    setInterval(getAverageMii,1800000);//30 Mins, should be adjusted for actual need - if the site gets big, every time a Mii is made will be too frequent, but 30 mins will be too long. If the site remains small, 30 mins will be far too frequent.
    fs.writeFileSync(`./static/miiImgs/average.jpg`, await miijs.renderMii(storage.miis.average));
    await miijs.write3DSQR(storage.miis.average, `./static/miiQRs/average.jpg`);
    save();
    console.log(`All setup finished.\nOnline`);
});

//The following up to and including /recent are all sorted before being renders in miis.ejs, meaning the file is recycled. / is currently just a clone of /top. /official and /search is more of the same but with a slight change to make Highlighted Mii still work without the full Mii array
site.get('/', (req, res) => {
    let toSend = getSendables(req);
    toSend.title = "InfiniMii";
    toSend.miiCategories={
        "Random":{miis:api("random",5),link:"./random"},
        "Top":{miis:api("top",5),link:"./top"},
        "All Time Top":{miis:api("best",5),link:"./best"},
        "Recent":{miis:api("recent",5),link:"./recent"},
        "Official":{miis:api("official",5),link:"./official"}
    };
    ejs.renderFile('./ejsFiles/index.ejs', toSend, {}, function(err, str) {
        if (err) {
            res.send(err);
            console.log(err);
            return;
        }
        res.send(str);
    });
});
site.get('/random', (req, res) => {
    let toSend = getSendables(req);
    toSend.displayedMiis = api("random",30);
    toSend.title = "Random Miis - InfiniMii";
    ejs.renderFile('./ejsFiles/miis.ejs', toSend, {}, function(err, str) {
        if (err) {
            res.send(err);
            console.log(err);
            return;
        }
        res.send(str)
    });
});
site.get('/top', (req, res) => {
    let toSend = getSendables(req);
    toSend.displayedMiis = api("top",30);
    toSend.title = "Top Miis - InfiniMii";
    ejs.renderFile('./ejsFiles/miis.ejs', toSend, {}, function(err, str) {
        if (err) {
            res.send(err);
            console.log(err);
            return;
        }
        res.send(str)
    });
});
site.get('/best', (req, res) => {
    let toSend = getSendables(req);
    toSend.displayedMiis = api("best",30);
    toSend.title = "All-Time Top Miis - InfiniMii";
    ejs.renderFile('./ejsFiles/miis.ejs', toSend, {}, function(err, str) {
        if (err) {
            res.send(err);
            console.log(err);
            return;
        }
        res.send(str)
    });
});
site.get('/recent', (req, res) => {
    let toSend = getSendables(req);
    toSend.displayedMiis = api("recent",30);
    toSend.title = "Recent Miis - InfiniMii";
    ejs.renderFile('./ejsFiles/miis.ejs', toSend, {}, function(err, str) {
        if (err) {
            res.send(err);
            console.log(err);
            return;
        }
        res.send(str)
    });
});
site.get('/official', (req, res) => {
    let toSend = getSendables(req);
    toSend.displayedMiis = api("official",30);
    toSend.title = "Official Miis - InfiniMii";
    ejs.renderFile('./ejsFiles/miis.ejs', toSend, {}, function(err, str) {
        if (err) {
            res.send(err);
            console.log(err);
            return;
        }
        res.send(str)
    });
});
site.get('/searchResults', (req, res) => {
    let toSend = getSendables(req)
    toSend.displayedMiis = api("search",30,0,req.query.q);
    toSend.title = "Search '" + req.query.q + "' - InfiniMii";
    ejs.renderFile('./ejsFiles/miis.ejs', toSend, {}, function(err, str) {
        if (err) {
            res.send(err);
            console.log(err);
            return;
        }
        res.send(str)
    });
});
site.get('/search', (req, res) => {
    ejs.renderFile('./ejsFiles/search.ejs', getSendables(req), {}, function(err, str) {
        if (err) {
            res.send(err);
            console.log(err);
            return;
        }
        res.send(str)
    });
});
site.get('/transferInstructions', (req, res) => {
    ejs.renderFile('./ejsFiles/transferInstructions.ejs', getSendables(req), {}, function(err, str) {
        if (err) {
            res.send(err);
            console.log(err);
            return;
        }
        res.send(str)
    });
});
site.get('/upload', (req, res) => {
    ejs.renderFile('./ejsFiles/upload.ejs', getSendables(req), {}, function(err, str) {
        if (err) {
            res.send(err);
            console.log(err);
            return;
        }
        res.send(str)
    });
});
site.get('/api', (req, res) => {
    try{
        res.send(api(req.query.type,req.query.arg));
    }
    catch(e){
        res.send(`{"okay":false,"error":"Invalid arguments"}`);
    }
});
site.get('/verify', async (req, res) => {
    try {
        if (validatePassword(req.query.token, storage.users[req.query.user].salt, storage.users[req.query.user].verificationToken)) {
            delete storage.users[req.query.user].verificationToken;
            let token = genToken();
            storage.users[req.query.user].token = hashPassword(token, storage.users[req.query.user].salt).hash;
            storage.users[req.query.user].verified = true;
            await res.cookie("username", req.query.user, { maxAge: 30 * 24 * 60 * 60 * 1000/*1 Month*/ });
            await res.cookie("token", token, { maxAge: 30 * 24 * 60 * 60 * 1000/*1 Month*/ });
            res.redirect("/");
        }
        else {
            res.send("{'error:'Bad request'}");
            return;
        }
        save();
    }
    catch (e) {
        res.send("Error");
        console.log(e);
    }
});
site.get('/deleteMii', (req, res) => {
    try {
        if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
            res.send("{'okay':false}");
            return;
        }
        if (storage.users[req.cookies.username].submissions.includes(req.query.id) || storage.users[req.cookies.username].roles.includes('moderator')) {
            var mii = storage.miis[req.query.id];
            storage.users[mii.uploader].submissions.splice(storage.users[mii.uploader].submissions.indexOf(mii.id), 1);
            var d = new Date();
            makeReport(JSON.stringify({
                embeds: [{
                    "type": "rich",
                    "title": (mii.official ? "Official " : "") + `Mii Deleted by ` + req.cookies.username,
                    "description": mii.desc,
                    "color": 0xff0000,
                    "fields": [
                        {
                            "name": `Mii Name`,
                            "value": mii.name,
                            "inline": true
                        },
                        {
                            "name": `${mii.official ? "Uploaded" : "Made"} by`,
                            "value": `[${mii.uploader}](https://miis.kestron.com/user?user=${mii.uploader})`,
                            "inline": true
                        },
                        {
                            "name": `Mii Creator Name (embedded in Mii file)`,
                            "value": mii.creatorName,
                            "inline": true
                        }
                    ],
                    "thumbnail": {
                        "url": `https://miis.kestron.com/miiImgs/${mii.id}.jpg`,
                        "height": 0,
                        "width": 0
                    },
                    "footer": {
                        "text": `Deleted at ${d.getHours()}:${d.getMinutes()}, ${d.toDateString()} UTC`
                    }
                }]
            }));
            if(mii.uploader!==req.cookies.username&&mii.uploader!=="Nintendo"){
                sendEmail(storage.users[mii.uploader].email,`${mii.meta.name} Deleted - InfiniMii`,`Hi ${mii.uploader}, a moderator deleted ${mii.name}. We ask that Miis posted to this website are respectful, free of curse words and slurs, and devoid of anything that can be considered NSFW. Additionally, Miis uploaded should be one's own, and not copied from another source. If you were attempting to upload an official Mii, you can reply to this email to discuss being made a Researcher, which are allowed to upload Official Miis.\n\nIf you are unsure why your Mii was deleted, you may reply to this email to receive support. Understand that repeated violations of rules may result in a ban from the site.`);
            }
            storage.miiIds.splice(storage.miiIds.indexOf(req.query.id), 1);
            delete storage.miis[req.query.id];
            fs.unlinkSync("./static/miiImgs/" + req.query.id + ".jpg");
            fs.unlinkSync("./static/miiQRs/" + req.query.id + ".jpg");
            res.send("{'okay':true}");
            save();
        }
        else {
            res.send("{'okay':false}");
        }
    }
    catch (e) {
        console.log(e);
        res.send("{'okay':false}");
    }
});
// Update Mii Field (Moderator only)
site.post('/updateMiiField', async (req, res) => {
    try {
        // Verify moderator
        if (!req.cookies.username || !req.cookies.token) {
            return res.json({ okay: false, error: 'Not authenticated' });
        }

        if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
            return res.json({ okay: false, error: 'Invalid token' });
        }

        if (!storage.users[req.cookies.username].roles.includes('moderator')) {
            return res.json({ okay: false, error: 'Not authorized' });
        }

        const { id, field, value } = req.body;

        if (!id || !field || value === undefined) {
            return res.json({ okay: false, error: 'Missing parameters' });
        }

        const mii = storage.miis[id];
        if (!mii) {
            return res.json({ okay: false, error: 'Mii not found' });
        }

        // Store old value for logging
        let oldValue;

        // Update the appropriate field
        switch (field) {
            case 'name':
                oldValue = mii.meta.name;
                mii.meta.name = value;
                break;
            case 'desc':
                oldValue = mii.desc;
                mii.desc = value;
                break;
            case 'creatorName':
                oldValue = mii.meta.creatorName;
                mii.meta.creatorName = value;
                break;
            case 'uploader':
                // Validate new uploader exists
                if (!storage.users[value]) {
                    return res.json({ okay: false, error: 'User does not exist' });
                }
                
                oldValue = mii.uploader;
                
                // Remove from old uploader's submissions
                const oldUploaderSubmissions = storage.users[mii.uploader].submissions;
                const index = oldUploaderSubmissions.indexOf(id);
                if (index > -1) {
                    oldUploaderSubmissions.splice(index, 1);
                }
                
                // Add to new uploader's submissions
                if (!storage.users[value].submissions.includes(id)) {
                    storage.users[value].submissions.push(id);
                }
                mii.uploader = value;
                break;
            default:
                return res.json({ okay: false, error: 'Invalid field' });
        }

        save();

        // Log to Discord
        makeReport(JSON.stringify({
            embeds: [{
                type: 'rich',
                title: `🛠️ Mii ${field} Updated`,
                description: `Moderator ${req.cookies.username} updated ${field}`,
                color: 0xFFA500,
                fields: [
                    {
                        name: 'Mii',
                        value: `[${mii.meta.name}](https://miis.kestron.com/mii?id=${id})`,
                        inline: true
                    },
                    {
                        name: 'Field',
                        value: field,
                        inline: true
                    },
                    {
                        name: 'Old Value',
                        value: oldValue || 'N/A',
                        inline: false
                    },
                    {
                        name: 'New Value',
                        value: value,
                        inline: false
                    }
                ],
                thumbnail: {
                    url: `https://miis.kestron.com/miiImgs/${id}.jpg`
                }
            }]
        }));

        res.json({ okay: true });
    } catch (e) {
        console.error('Error updating Mii field:', e);
        res.json({ okay: false, error: 'Server error' });
    }
});
// Regenerate QR Code (Moderator only)
site.get('/regenerateQR', async (req, res) => {
    try {
        // Verify moderator
        if (!req.cookies.username || !req.cookies.token) {
            return res.json({ okay: false, error: 'Not authenticated' });
        }

        if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
            return res.json({ okay: false, error: 'Invalid token' });
        }

        if (!storage.users[req.cookies.username].roles.includes('moderator')) {
            return res.json({ okay: false, error: 'Not authorized' });
        }

        const { id } = req.query;
        const mii = storage.miis[id];

        if (!mii) {
            return res.json({ okay: false, error: 'Mii not found' });
        }

        // Regenerate the QR code
        await miijs.write3DSQR(mii, `./static/miiQRs/${id}.jpg`);

        // Log to Discord
        makeReport(JSON.stringify({
            embeds: [{
                type: 'rich',
                title: '🔄 QR Code Regenerated',
                description: `Moderator ${req.cookies.username} regenerated QR code`,
                color: 0x00AFF0,
                fields: [
                    {
                        name: 'Mii',
                        value: `[${mii.meta.name}](https://miis.kestron.com/mii?id=${id})`,
                        inline: true
                    }
                ],
                thumbnail: {
                    url: `https://miis.kestron.com/miiImgs/${id}.jpg`
                }
            }]
        }));

        res.json({ okay: true });
    } catch (e) {
        console.error('Error regenerating QR:', e);
        res.json({ okay: false, error: 'Server error' });
    }
});
// Add Role to User (Admin only)
site.post('/addUserRole', async (req, res) => {
    try {
        if (!req.cookies.username || !req.cookies.token) {
            return res.json({ okay: false, error: 'Not authenticated' });
        }

        if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
            return res.json({ okay: false, error: 'Invalid token' });
        }

        const currentUser = storage.users[req.cookies.username];
        if (!isAdmin(currentUser)) {
            return res.json({ okay: false, error: 'Only administrators can manage roles' });
        }

        const { username, role } = req.body;
        const targetUser = storage.users[username];

        if (!targetUser) {
            return res.json({ okay: false, error: 'User not found' });
        }

        if (!Object.values(ROLES).includes(role)) {
            return res.json({ okay: false, error: 'Invalid role' });
        }

        addRole(targetUser, role);
        save();

        makeReport(JSON.stringify({
            embeds: [{
                type: 'rich',
                title: '➕ Role Added to User',
                description: `Administrator ${req.cookies.username} added a role`,
                color: 0x00FF00,
                fields: [
                    {
                        name: 'User',
                        value: username,
                        inline: true
                    },
                    {
                        name: 'Role Added',
                        value: ROLE_DISPLAY[role],
                        inline: true
                    },
                    {
                        name: 'Current Roles',
                        value: getUserRoles(targetUser).map(r => ROLE_DISPLAY[r]).join(', '),
                        inline: false
                    }
                ]
            }]
        }));
        if(['researcher','moderator','administrator'].includes(role.toLowerCase())){
            sendEmail(targetUser.email,`New Role Added - InfiniMii`,`Congratulations ${username}, you were made a ${role[0].toUpperCase()}${role.slice(1,role.length)} on InfiniMii!`);
        }

        res.json({ okay: true, roles: targetUser.roles });
    } catch (e) {
        console.error('Error adding user role:', e);
        res.json({ okay: false, error: 'Server error' });
    }
});

// Remove Role from User (Admin only)
site.post('/removeUserRole', async (req, res) => {
    try {
        if (!req.cookies.username || !req.cookies.token) {
            return res.json({ okay: false, error: 'Not authenticated' });
        }

        if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
            return res.json({ okay: false, error: 'Invalid token' });
        }

        const currentUser = storage.users[req.cookies.username];
        if (!isAdmin(currentUser)) {
            return res.json({ okay: false, error: 'Only administrators can manage roles' });
        }

        const { username, role } = req.body;
        const targetUser = storage.users[username];

        if (!targetUser) {
            return res.json({ okay: false, error: 'User not found' });
        }

        removeRole(targetUser, role);
        save();

        makeReport(JSON.stringify({
            embeds: [{
                type: 'rich',
                title: '➖ Role Removed from User',
                description: `Administrator ${req.cookies.username} removed a role`,
                color: 0xFF9900,
                fields: [
                    {
                        name: 'User',
                        value: username,
                        inline: true
                    },
                    {
                        name: 'Role Removed',
                        value: ROLE_DISPLAY[role],
                        inline: true
                    },
                    {
                        name: 'Current Roles',
                        value: getUserRoles(targetUser).map(r => ROLE_DISPLAY[r]).join(', '),
                        inline: false
                    }
                ]
            }]
        }));

        res.json({ okay: true, roles: targetUser.roles });
    } catch (e) {
        console.error('Error removing user role:', e);
        res.json({ okay: false, error: 'Server error' });
    }
});

// Temporary Ban User (Moderator+)
site.post('/tempBanUser', async (req, res) => {
    try {
        if (!req.cookies.username || !req.cookies.token) {
            return res.json({ okay: false, error: 'Not authenticated' });
        }

        if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
            return res.json({ okay: false, error: 'Invalid token' });
        }

        const currentUser = storage.users[req.cookies.username];
        if (!canModerate(currentUser)) {
            return res.json({ okay: false, error: 'Insufficient permissions' });
        }

        const { username, hours, reason } = req.body;
        const targetUser = storage.users[username];

        if (!targetUser) {
            return res.json({ okay: false, error: 'User not found' });
        }

        // Moderators can't ban admins or other moderators
        if (!isAdmin(currentUser) && canModerate(targetUser)) {
            return res.json({ okay: false, error: 'Cannot ban moderators or administrators' });
        }

        addRole(targetUser, ROLES.TEMP_BANNED);
        targetUser.banExpires = Date.now() + (hours * 60 * 60 * 1000);
        targetUser.banReason = reason;

        save();

        makeReport(JSON.stringify({
            embeds: [{
                type: 'rich',
                title: '⏰ User Temporarily Banned',
                description: `${req.cookies.username} temporarily banned a user`,
                color: 0xFF9900,
                fields: [
                    {
                        name: 'User',
                        value: username,
                        inline: true
                    },
                    {
                        name: 'Duration',
                        value: `${hours} hours`,
                        inline: true
                    },
                    {
                        name: 'Reason',
                        value: reason || 'No reason provided',
                        inline: false
                    }
                ]
            }]
        }));
        sendEmail(targetUser.email,`Ban - InfiniMii`,`Hi ${username}, you were banned on InfiniMii for the next ${hours}. ${reason?`Reason: ${reason}`:`No reason was specified at this time.`} Understand that repeated violations may result in a permanent ban and account deletion. You may reply to this email for support.`);

        res.json({ okay: true });
    } catch (e) {
        console.error('Error temp banning user:', e);
        res.json({ okay: false, error: 'Server error' });
    }
});

// Permanent Ban User (Admin only)
site.post('/permBanUser', async (req, res) => {
    try {
        if (!req.cookies.username || !req.cookies.token) {
            return res.json({ okay: false, error: 'Not authenticated' });
        }

        if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
            return res.json({ okay: false, error: 'Invalid token' });
        }

        const currentUser = storage.users[req.cookies.username];
        if (!isAdmin(currentUser)) {
            return res.json({ okay: false, error: 'Only administrators can permanently ban users' });
        }

        const { username, reason } = req.body;
        const targetUser = storage.users[username];

        if (!targetUser) {
            return res.json({ okay: false, error: 'User not found' });
        }

        const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        
        // Ban IP if not VPN
        if (!isVPN(clientIP)) {
            const ipHash = hashIP(clientIP);
            if (!storage.bannedIPs.includes(ipHash)) {
                storage.bannedIPs.push(ipHash);
            }
        }

        // Delete all user's Miis
        const miiIds = [...targetUser.submissions];
        for (const miiId of miiIds) {
            try {
                const mii = storage.miis[miiId];
                if (mii) {
                    // Remove from miiIds
                    const index = storage.miiIds.indexOf(miiId);
                    if (index > -1) storage.miiIds.splice(index, 1);
                    
                    // Delete files
                    try { fs.unlinkSync(`./static/miiImgs/${miiId}.jpg`); } catch(e) {}
                    try { fs.unlinkSync(`./static/miiQRs/${miiId}.jpg`); } catch(e) {}
                    
                    // Delete Mii data
                    delete storage.miis[miiId];
                }
            } catch(e) {
                console.error(`Error deleting Mii ${miiId}:`, e);
            }
        }

        // Delete user account
        delete storage.users[username];

        save();

        makeReport(JSON.stringify({
            embeds: [{
                type: 'rich',
                title: '⛔ User Permanently Banned',
                description: `${req.cookies.username} permanently banned a user`,
                color: 0xFF0000,
                fields: [
                    {
                        name: 'User',
                        value: username,
                        inline: true
                    },
                    {
                        name: 'Miis Deleted',
                        value: miiIds.length.toString(),
                        inline: true
                    },
                    {
                        name: 'IP Banned',
                        value: !isVPN(clientIP) ? 'Yes' : 'No (VPN detected)',
                        inline: true
                    },
                    {
                        name: 'Reason',
                        value: reason || 'No reason provided',
                        inline: false
                    }
                ]
            }]
        }));
        sendEmail(targetUser.email,`Permanent Ban - InfiniMii`,`Hi ${username}, due to repeated and/or serious violations of rules on InfiniMii, you have been permanently banned from the website. ${reason?`Reason: ${reason}`:`No reason was provided at this time.`} This will prevent you from making any new accounts in the future, and all uploaded Miis have been deleted. If you feel this is in error, you may reply to this email to receive support.`)

        res.json({ okay: true });
    } catch (e) {
        console.error('Error perm banning user:', e);
        res.json({ okay: false, error: 'Server error' });
    }
});

// Delete All User Miis (Moderator+)
site.post('/deleteAllUserMiis', async (req, res) => {
    try {
        if (!req.cookies.username || !req.cookies.token) {
            return res.json({ okay: false, error: 'Not authenticated' });
        }

        if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
            return res.json({ okay: false, error: 'Invalid token' });
        }

        const currentUser = storage.users[req.cookies.username];
        if (!canModerate(currentUser)) {
            return res.json({ okay: false, error: 'Insufficient permissions' });
        }

        const { username } = req.body;
        const targetUser = storage.users[username];

        if (!targetUser) {
            return res.json({ okay: false, error: 'User not found' });
        }

        const miiIds = [...targetUser.submissions];
        let deletedCount = 0;

        for (const miiId of miiIds) {
            try {
                const mii = storage.miis[miiId];
                if (mii) {
                    // Remove from miiIds
                    const index = storage.miiIds.indexOf(miiId);
                    if (index > -1) storage.miiIds.splice(index, 1);
                    
                    // Delete files
                    try { fs.unlinkSync(`./static/miiImgs/${miiId}.jpg`); } catch(e) {}
                    try { fs.unlinkSync(`./static/miiQRs/${miiId}.jpg`); } catch(e) {}
                    
                    // Delete Mii data
                    delete storage.miis[miiId];
                    deletedCount++;
                }
            } catch(e) {
                console.error(`Error deleting Mii ${miiId}:`, e);
            }
        }

        targetUser.submissions = [];
        save();

        makeReport(JSON.stringify({
            embeds: [{
                type: 'rich',
                title: '🗑️ All User Miis Deleted',
                description: `${req.cookies.username} deleted all Miis from user ${username}`,
                color: 0xFF6600,
                fields: [
                    {
                        name: 'User',
                        value: username,
                        inline: true
                    },
                    {
                        name: 'Miis Deleted',
                        value: deletedCount.toString(),
                        inline: true
                    }
                ]
            }]
        }));
        //There is very very little reason this will not precede a ban, so we're not going to bother emailing the user for this one.

        res.json({ okay: true, deletedCount });
    } catch (e) {
        console.error('Error deleting all user Miis:', e);
        res.json({ okay: false, error: 'Server error' });
    }
});

// Change Username (Moderator+)
site.post('/changeUsername', async (req, res) => {
    try {
        if (!req.cookies.username || !req.cookies.token) {
            return res.json({ okay: false, error: 'Not authenticated' });
        }

        if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
            return res.json({ okay: false, error: 'Invalid token' });
        }

        const currentUser = storage.users[req.cookies.username];
        if (!canModerate(currentUser)) {
            return res.json({ okay: false, error: 'Insufficient permissions' });
        }

        const { oldUsername, newUsername } = req.body;

        if (!validate(newUsername)) {
            return res.json({ okay: false, error: 'Invalid username format' });
        }

        if (storage.users[newUsername]) {
            return res.json({ okay: false, error: 'Username already taken' });
        }

        const user = storage.users[oldUsername];
        if (!user) {
            return res.json({ okay: false, error: 'User not found' });
        }

        // Update username in storage
        storage.users[newUsername] = user;
        delete storage.users[oldUsername];

        // Update uploader field in all user's Miis
        user.submissions.forEach(miiId => {
            if (storage.miis[miiId]) {
                storage.miis[miiId].uploader = newUsername;
            }
        });

        save();

        makeReport(JSON.stringify({
            embeds: [{
                type: 'rich',
                title: '✏️ Username Changed',
                description: `${req.cookies.username} changed a username`,
                color: 0x00FF00,
                fields: [
                    {
                        name: 'Old Username',
                        value: oldUsername,
                        inline: true
                    },
                    {
                        name: 'New Username',
                        value: newUsername,
                        inline: true
                    }
                ]
            }]
        }));
        sendEmail(user.email,`Username Changed - InfiniMii`,`Hi ${oldUsername}, a moderator has changed your username to ${newUsername}. This will be what you login with moving forward. You can reply to this email to receive support.`);

        res.json({ okay: true });
    } catch (e) {
        console.error('Error changing username:', e);
        res.json({ okay: false, error: 'Server error' });
    }
});

// Toggle Mii Official Status (Moderator+)
site.post('/toggleMiiOfficial', async (req, res) => {
    try {
        // Verify moderator
        if (!req.cookies.username || !req.cookies.token) {
            return res.json({ okay: false, error: 'Not authenticated' });
        }

        if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
            return res.json({ okay: false, error: 'Invalid token' });
        }

        const currentUser = storage.users[req.cookies.username];
        if (!canModerate(currentUser)) {
            return res.json({ okay: false, error: 'Not authorized' });
        }

        const { id, official } = req.body;

        if (!id || official === undefined) {
            return res.json({ okay: false, error: 'Missing parameters' });
        }

        const mii = storage.miis[id];
        if (!mii) {
            return res.json({ okay: false, error: 'Mii not found' });
        }

        const oldStatus = mii.official;
        mii.official = official;

        save();

        // Log to Discord
        makeReport(JSON.stringify({
            embeds: [{
                type: 'rich',
                title: official ? '⭐ Mii Marked as Official' : '❌ Mii Unmarked as Official',
                description: `Moderator ${req.cookies.username} changed official status`,
                color: official ? 0xFFD700 : 0x808080,
                fields: [
                    {
                        name: 'Mii',
                        value: `[${mii.meta.name}](https://miis.kestron.com/mii?id=${id})`,
                        inline: true
                    },
                    {
                        name: 'Old Status',
                        value: oldStatus ? 'Official' : 'Not Official',
                        inline: true
                    },
                    {
                        name: 'New Status',
                        value: official ? 'Official' : 'Not Official',
                        inline: true
                    }
                ],
                thumbnail: {
                    url: `https://miis.kestron.com/miiImgs/${id}.jpg`
                }
            }]
        }));

        res.json({ okay: true });
    } catch (e) {
        console.error('Error toggling official status:', e);
        res.json({ okay: false, error: 'Server error' });
    }
});
// ========== AMIIBO ENDPOINTS ==========

// Amiibo tools page
site.get('/amiibo', (req, res) => {
    ejs.renderFile('./ejsFiles/amiibo.ejs', getSendables(req), {}, function(err, str) {
        if (err) {
            res.send(err);
            console.log(err);
            return;
        }
        res.send(str)
    });
});

// Extract Mii from Amiibo
site.post('/extractMiiFromAmiibo', upload.single('amiibo'), async (req, res) => {
    try {
        if (!req.file) {
            res.json({ okay: false, error: 'No Amiibo file uploaded' });
            return;
        }
        
        // Read the Amiibo dump
        const amiiboDump = fs.readFileSync("./uploads/" + req.file.filename);
        
        // Extract Mii data (92 bytes, decrypted 3DS format)
        const miiData = miijs.extractMiiFromAmiibo(amiiboDump);
        
        // Convert to JSON - miiData is already decrypted 3DS format
        const mii = await miijs.read3DSQR(miiData, false);
        
        // Generate ID and save temporarily
        mii.id = genId();
        mii.uploadedOn = Date.now();
        mii.uploader = "temp_" + mii.id;
        mii.desc = "Extracted from Amiibo";
        mii.votes = 0;
        mii.official = false;
        
        // Render images
        await miijs.renderMii(mii, "./static/miiImgs/" + mii.id + ".png");
        await miijs.write3DSQR(mii, "./static/miiQRs/" + mii.id + ".png");
        
        // Clean up upload
        try { fs.unlinkSync("./uploads/" + req.file.filename); } catch (e) { }
        
        res.json({ okay: true, mii: mii });
    } catch (e) {
        console.error('Error extracting Mii from Amiibo:', e);
        try { fs.unlinkSync("./uploads/" + req.file.filename); } catch (e) { }
        res.json({ okay: false, error: 'Failed to extract Mii from Amiibo: ' + e.message });
    }
});

// Insert Mii into Amiibo
site.post('/insertMiiIntoAmiibo', upload.fields([
    { name: 'amiibo', maxCount: 1 },
    { name: 'mii', maxCount: 1 }
]), async (req, res) => {
    try {
        if (!req.files.amiibo || !req.files.amiibo[0]) {
            res.json({ okay: false, error: 'No Amiibo file uploaded' });
            return;
        }
        
        // Read the Amiibo dump
        const amiiboDump = fs.readFileSync(req.files.amiibo[0].path);
        
        let miiData;
        const source = req.body.miiSource;
        
        // Get Mii data based on source
        if (source === 'file') {
            if (!req.files.mii || !req.files.mii[0]) {
                res.json({ okay: false, error: 'No Mii file uploaded' });
                try { fs.unlinkSync(req.files.amiibo[0].path); } catch (e) { }
                return;
            }
            
            let mii;
            const miiType = req.body.miiType;
            
            if (miiType === 'wii') {
                mii = await miijs.readWiiBin(req.files.mii[0].path);
                mii = miijs.convertMii(mii, '3ds');
            }
            else if (miiType === '3ds') {
                mii = await miijs.read3DSQR(req.files.mii[0].path);
            }
            else if (miiType === '3dsbin') {
                // Handle both encrypted and decrypted bins
                const binData = fs.readFileSync(req.files.mii[0].path);
                mii = await miijs.read3DSQR(binData, false);
            }
            
            // Get decrypted binary data
            miiData = await miijs.read3DSQR(req.files.mii[0].path, true);
            
            try { fs.unlinkSync(req.files.mii[0].path); } catch (e) { }
            
        }
        else if (source === 'miiId') {
            const miiId = req.body.miiId;
            if (!storage.miis[miiId]) {
                res.json({ okay: false, error: 'Invalid Mii ID' });
                try { fs.unlinkSync(req.files.amiibo[0].path); } catch (e) { }
                return;
            }
            
            const mii = storage.miis[miiId];
            // Convert to decrypted binary
            const qrPath = "./static/miiQRs/" + miiId + ".png";
            miiData = await miijs.read3DSQR(qrPath, true);
            
        }
        else if (source === 'studio') {
            let studioCode = req.body.studioCode.trim();
            
            // Extract code from URL if provided
            if (studioCode.includes('studio.mii.nintendo.com')) {
                const match = studioCode.match(/data=([0-9a-fA-F]+)/);
                if (match) studioCode = match[1];
            }
            
            // Convert Studio to 3DS format
            const mii = miijs.convertStudioToMii(studioCode);
            
            // Write temporary QR and extract binary
            const tempPath = "./static/temp/" + genId() + ".png";
            await miijs.write3DSQR(mii, tempPath);
            miiData = await miijs.read3DSQR(tempPath, true);
            try { fs.unlinkSync(tempPath); } catch (e) { }
        }
        
        // Insert Mii into Amiibo
        const modifiedAmiibo = miijs.insertMiiIntoAmiibo(amiiboDump, miiData);
        
        // Clean up
        try { fs.unlinkSync(req.files.amiibo[0].path); } catch (e) { }
        
        // Send modified Amiibo
        res.setHeader('Content-Disposition', 'attachment; filename="amiibo_modified.bin"');
        res.setHeader('Content-Type', 'application/octet-stream');
        res.send(modifiedAmiibo);
        
    } catch (e) {
        console.error('Error inserting Mii into Amiibo:', e);
        try { 
            if (req.files.amiibo) fs.unlinkSync(req.files.amiibo[0].path);
            if (req.files.mii) fs.unlinkSync(req.files.mii[0].path);
        } catch (cleanupErr) { }
        res.json({ okay: false, error: 'Failed to insert Mii into Amiibo: ' + e.message });
    }
});

// ========== STUDIO ENDPOINTS ==========

// Upload Mii from Studio code
site.post('/uploadStudioMii', async (req, res) => {
    try {
        let uploader = req.cookies.username;
        if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
            res.send("{'okay':false, 'error':'Invalid credentials'}");
            return;
        }
        
        const user = storage.users[uploader];
        
        // Check official Mii permissions
        if (req.body.official && !canUploadOfficial(user)) {
            res.send("{'error':'Only Researchers and Administrators can upload official Miis'}");
            return;
        }
        
        let studioCode = req.body.studioCode.trim();
        
        // Extract code from URL if provided
        if (studioCode.includes('studio.mii.nintendo.com')) {
            const match = studioCode.match(/data=([0-9a-fA-F]+)/);
            if (match) {
                studioCode = match[1];
            }
        }
        
        // Validate hex format
        if (!/^[0-9a-fA-F]+$/.test(studioCode)) {
            res.send("{'error':'Invalid Studio code format'}");
            return;
        }
        
        // Convert Studio to 3DS Mii
        const mii = miijs.convertStudioToMii(studioCode);
        
        mii.id = genId();
        mii.uploadedOn = Date.now();
        mii.uploader = req.body.official ? "Nintendo" : uploader;
        mii.desc = req.body.desc || "";
        mii.votes = 1;
        mii.official = req.body.official || false;
        
        // Render images
        await miijs.renderMii(mii, "./static/miiImgs/" + mii.id + ".png");
        await miijs.write3DSQR(mii, "./static/miiQRs/" + mii.id + ".png");
        
        // Save to storage
        storage.miis[mii.id] = mii;
        storage.miiIds.push(mii.id);
        storage.users[mii.uploader].submissions.push(mii.id);
        save();
        
        // Report to Discord
        var d = new Date();
        makeReport(JSON.stringify({
            embeds: [{
                "type": "rich",
                "title": (req.body.official ? "Official " : "") + "Mii Uploaded from Studio",
                "description": "**" + mii.meta.name + "** uploaded by **" + uploader + "**",
                "color": 0x25d366,
                "thumbnail": {
                    "url": "https://infinimii.kestron.com/miiImgs/" + mii.id + ".png",
                    "height": 0,
                    "width": 0
                },
                "footer": {
                    "text": d.toDateString() + " " + d.toTimeString()
                }
            }]
        }));
        
        setTimeout(() => { res.redirect("/mii?id=" + mii.id) }, 2000);
        
    } catch (e) {
        console.error('Error uploading Studio Mii:', e);
        res.send("{'error':'Failed to upload Mii from Studio: " + e.message + "'}");
    }
});

// ========== DOWNLOAD ENDPOINTS ==========

// Download Mii in various formats
site.get('/downloadMii', async (req, res) => {
    try {
        const miiId = req.query.id;
        const format = req.query.format;
        
        if (!storage.miis[miiId]) {
            res.send("{'error':'Invalid Mii ID'}");
            return;
        }
        
        const mii = storage.miis[miiId];
        const miiName = mii.meta.name.replace(/[^a-z0-9]/gi, '_');
        
        if (format === 'qr' || format === '3dsqr') {
            // Download QR code
            const qrPath = "./static/miiQRs/" + miiId + ".png";
            res.setHeader('Content-Disposition', `attachment; filename="${miiName}_QR.png"`);
            res.sendFile(qrPath, { root: path.join(__dirname, "./") });
            
        }
        else if (format === '3dsbin' || format === '3dsbin_decrypted') {
            // Download decrypted 3DS bin
            const qrPath = "./static/miiQRs/" + miiId + ".png";
            const binData = await miijs.read3DSQR(qrPath, true);
            
            res.setHeader('Content-Disposition', `attachment; filename="${miiName}_decrypted.bin"`);
            res.setHeader('Content-Type', 'application/octet-stream');
            res.send(binData);
            
        }
        else if (format === '3dsbin_encrypted') {
            // Download encrypted 3DS bin (from QR)
            const qrPath = "./static/miiQRs/" + miiId + ".png";
            // Read QR and extract the encrypted portion
            // This requires reading the QR image and extracting the data payload
            // For now, we'll create a new encrypted QR and extract from it
            const tempQR = "./static/temp/" + genId() + ".png";
            await miijs.write3DSQR(mii, tempQR);
            
            // Read the encrypted data from the QR
            // This is a placeholder - you may need to implement QR reading
            const encryptedData = await miijs.read3DSQR(tempQR, true);
            
            try { fs.unlinkSync(tempQR); } catch (e) { }
            
            res.setHeader('Content-Disposition', `attachment; filename="${miiName}_encrypted.bin"`);
            res.setHeader('Content-Type', 'application/octet-stream');
            res.send(encryptedData);
            
        }
        else if (format === 'wii' || format === 'wiibin') {
            // Convert to Wii and download
            const wiiMii = miijs.convertMii(mii, 'wii');
            const binData = await miijs.writeWiiBin(wiiMii);
            
            res.setHeader('Content-Disposition', `attachment; filename="${miiName}.mii"`);
            res.setHeader('Content-Type', 'application/octet-stream');
            res.send(binData);
            
        }
        else if (format === 'studio') {
            // Convert to Studio format and return as text
            const studioCode = miijs.convertMiiToStudio(mii);
            
            res.setHeader('Content-Disposition', `attachment; filename="${miiName}_studio.txt"`);
            res.setHeader('Content-Type', 'text/plain');
            res.send(studioCode);
            
        }
        else {
            res.send("{'error':'Invalid format specified'}");
        }
        
    } catch (e) {
        console.error('Error downloading Mii:', e);
        res.send("{'error':'Failed to download Mii: " + e.message + "'}");
    }
});

// Get Studio code for a Mii (for copying)
site.get('/getStudioCode', (req, res) => {
    try {
        const miiId = req.query.id;
        
        if (!storage.miis[miiId]) {
            res.json({ okay: false, error: 'Invalid Mii ID' });
            return;
        }
        
        const mii = storage.miis[miiId];
        const studioCode = miijs.convertMiiToStudio(mii);
        
        res.json({ 
            okay: true, 
            code: studioCode,
            url: `https://studio.mii.nintendo.com/miis/image.png?data=${studioCode}`
        });
        
    } catch (e) {
        console.error('Error getting Studio code:', e);
        res.json({ okay: false, error: 'Failed to get Studio code: ' + e.message });
    }
});

// Change User PFP (Moderator+)
site.post('/changeUserPfp', async (req, res) => {
    try {
        if (!req.cookies.username || !req.cookies.token) {
            return res.json({ okay: false, error: 'Not authenticated' });
        }

        if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
            return res.json({ okay: false, error: 'Invalid token' });
        }

        const currentUser = storage.users[req.cookies.username];
        if (!canModerate(currentUser)) {
            return res.json({ okay: false, error: 'Insufficient permissions' });
        }

        const { username, miiId } = req.body;
        const targetUser = storage.users[username];

        if (!targetUser) {
            return res.json({ okay: false, error: 'User not found' });
        }

        if (!storage.miis[miiId]) {
            return res.json({ okay: false, error: 'Mii not found' });
        }

        targetUser.miiPfp = miiId;
        save();

        makeReport(JSON.stringify({
            embeds: [{
                type: 'rich',
                title: '🖼️ User PFP Changed',
                description: `${req.cookies.username} changed profile picture for ${username}`,
                color: 0x00CCFF,
                fields: [
                    {
                        name: 'User',
                        value: username,
                        inline: true
                    },
                    {
                        name: 'New PFP Mii ID',
                        value: miiId,
                        inline: true
                    }
                ],
                thumbnail: {
                    url: `https://miis.kestron.com/miiImgs/${miiId}.jpg`
                }
            }]
        }));

        res.json({ okay: true });
    } catch (e) {
        console.error('Error changing user PFP:', e);
        res.json({ okay: false, error: 'Server error' });
    }
});
site.get('/voteMii', (req, res) => {
    if (!req.query.id) {
        res.send("{'error':'No ID specified'}");
        return;
    }
    try {
        if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
            res.send("{'error':'Invalid token'}");
            return;
        }
        if (storage.users[req.cookies.username].submissions.includes(req.query.id)) {
            res.send("{'error':'You submitted this Mii'}");
            return;
        }
        if (storage.users[req.cookies.username].votedFor.includes(req.query.id)) {
            storage.users[req.cookies.username].votedFor.splice(storage.users[req.cookies.username].votedFor.indexOf(req.query.id), 1);
            storage.miis[req.query.id].votes--;
            res.send("Unliked");
            save();
            return;
        }
        storage.users[req.cookies.username].votedFor.push(req.query.id);
        storage.miis[req.query.id].votes++;
        res.send("Liked");
    }
    catch (e) {
        res.send("{'error':`" + e + "`}");
        return;
    }
    save();
});
site.get('/mii', (req, res) => {
    let inp = getSendables(req);
    inp.mii = req.query.id==="average"?storage.miis.average:storage.miis[req.query.id];
    inp.height=miijs.miiHeightToFeetInches(inp.mii.general.height);
    inp.weight=miijs.miiWeightToRealWeight(inp.mii.general.height,inp.mii.general.weight);
    ejs.renderFile('./ejsFiles/miiPage.ejs', inp, {}, function(err, str) {
        if (err) {
            res.send(err);
            console.log(err);
            return;
        }
        res.send(str)
    });
});
site.get('/user', (req, res) => {
    if (req.query.user === "Nintendo") {
        res.redirect('/official');
        return;
    }
    let inp = getSendables(req);
    inp.user = storage.users[req.query.user];
    inp.user.name = req.query.user;
    inp.displayedMiis = [];
    storage.users[req.query.user].submissions.forEach(mii => {
        inp.displayedMiis.push(storage.miis[mii]);
    });
    ejs.renderFile('./ejsFiles/userPage.ejs', inp, {}, function(err, str) {
        if (err) {
            res.send(err);
            console.log(err);
            return;
        }
        res.send(str)
    });
});
site.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, "./static/signup.html"));
});
site.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, "./static/login.html"));
});
site.get('/logout', async (req, res) => {
    try {
        if (validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
            res.send("{'error':'Invalid token'}");
            storage.users[req.cookies.username].token = "";
            return;
        }
        await res.clearCookie('username');
        await res.clearCookie('token');
        res.redirect("/");
    }
    catch (e) {
        console.log(e);
    }
    save();
});
site.get('/convert', (req, res) => {
    ejs.renderFile('./ejsFiles/convert.ejs', getSendables(req), {}, function(err, str) {
        if (err) {
            res.send(err);
            console.log(err);
            return;
        }
        res.send(str)
    });
});
site.get('/qr', (req, res) => {
    ejs.renderFile('./ejsFiles/qr.ejs', getSendables(req), {}, function(err, str) {
        if (err) {
            res.send(err);
            console.log(err);
            return;
        }
        res.send(str)
    });
});
site.get('/settings', (req, res) => {
    if (!req.cookies.username) {
        res.redirect("/");
        return;
    }
    var toSend=getSendables(req);
    ejs.renderFile('./ejsFiles/settings.ejs', toSend, {}, function(err, str) {
        if (err) {
            res.send(err);
            console.log(err);
            return;
        }
        res.send(str)
    });
});
site.get('/changePfp', (req, res) => {
    if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
        res.send(`{"okay":false,"msg":"Invalid account"}`);
        return;
    }
    if (req.query.id?.length > 0 && storage.miiIds.includes(req.query.id)) {
        storage.users[req.cookies.username].miiPfp = req.query.id;
        res.send(`{"okay":true}`);
        save();
    }
    else {
        res.send(`{"okay":false,"msg":"Invalid Mii ID"}`);
    }
});
site.get('/changeUser', (req, res) => {
    if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
        res.send(`{"okay":false,"msg":"Invalid account"}`);
        return;
    }
    if (validate(req.query.newUser) && !storage.users[req.query.newUser]) {
        storage.users[req.query.newUser] = objCopy(storage.users[req.cookies.username]);
        storage.users[req.cookies.username].submissions.forEach(mii => {
            try { storage.miis[mii].uploader = req.query.newUser; } catch (e) { }
        });
        delete storage.users[req.cookies.username];
        var d = new Date();
        makeReport(JSON.stringify({
            embeds: [{
                "type": "rich",
                "title": `Username Changed`,
                "description": `${req.cookies.username} is now ${req.query.newUser}`,
                "color": 0xff0000,
                "thumbnail": {
                    "url": `https://miis.kestron.com/miiImgs/${storage.users[req.query.newUser].miiPfp}.jpg`,
                    "height": 0,
                    "width": 0
                },
                "footer": {
                    "text": `Changed at ${d.getHours()}:${d.getMinutes()}, ${d.toDateString()} UTC`
                },
                "url": `https://miis.kestron.com/user?user=${req.query.newUser}`
            }]
        }));
        save();
        res.cookie('username', req.query.newUser, { maxAge: 30 * 24 * 60 * 60 * 1000/*1 Month*/ });
        res.send(`{"okay":true}`);
    }
    else {
        res.send(`{"okay":false,"msg":"Username invalid"}`);
    }
});
site.get('/changehighlightedMii', (req, res) => {
    if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token) || !storage.users[req.cookies.username].roles.includes('moderator')) {
        res.send(`{"okay":false,"msg":"Invalid account"}`);
        return;
    }
    if (req.query.id?.length > 0 && storage.miiIds.includes(req.query.id)) {
        storage.highlightedMii = req.query.id;
        res.send(`{"okay":true}`);
        var mii = storage.miis[storage.highlightedMii];
        storage.highlightedMiiChangeDay = new Date().getDate();
        makeReport(JSON.stringify({
            embeds: [{
                "type": "rich",
                "title": (mii.official ? "Official " : "") + `Mii set as Highlighted Mii`,
                "description": mii.desc,
                "color": 0xff0000,
                "fields": [
                    {
                        "name": `Mii Name`,
                        "value": mii.name,
                        "inline": true
                    },
                    {
                        "name": `Uploaded by`,
                        "value": `[${mii.uploader}](https://miis.kestron.com/user?user=${mii.uploader})`,
                        "inline": true
                    },
                    {
                        "name": `Mii Creator Name (embedded in Mii file)`,
                        "value": mii.creatorName,
                        "inline": true
                    }
                ],
                "thumbnail": {
                    "url": `https://miis.kestron.com/miiImgs/${mii.id}.jpg`,
                    "height": 0,
                    "width": 0
                },
                "footer": {
                    "text": `New Highlighted Mii set by ${req.cookies.username}`
                },
                "url": `https://miis.kestron.com/mii?id=` + mii.id
            }]
        }));
        save();
    }
    else {
        res.send(`{"okay":false,"msg":"Invalid Mii ID"}`);
    }
});
site.get('/reportMii',(req,res)=>{
    var mii=storage.miis[req.query.id];
    makeReport(JSON.stringify({
        embeds: [{
            "type": "rich",
            "title": (mii.official ? "Official " : "") + `Mii has been reported`,
            "description": req.query.what,
            "color": 0xff0000,
            "fields": [
                {
                    "name": `Mii Name`,
                    "value": mii.name,
                    "inline": true
                },
                {
                    "name":"Description",
                    "value":mii.desc,
                    "inline":true
                },
                {
                    "name": `Uploaded by`,
                    "value": `[${mii.uploader}](https://miis.kestron.com/user?user=${mii.uploader})`,
                    "inline": true
                },
                {
                    "name": `Mii Creator Name (embedded in Mii file)`,
                    "value": mii.creatorName,
                    "inline": true
                }
            ],
            "thumbnail": {
                "url": `https://miis.kestron.com/miiImgs/${mii.id}.jpg`,
                "height": 0,
                "width": 0
            },
            "footer": {
                "text": `Mii has been reported by ${req.cookies.username?req.cookies.username:"Anonymous"}`
            },
            "url": `https://miis.kestron.com/mii?id=` + mii.id
        }]
    }));
    res.send(`{"okay":true}`);
});
site.get('/miiWii',async (req,res)=>{
    const mii=await miijs.convertMii(storage.miis[req.query.id]);
    console.log(mii.meta.name);
    var miiBuffer=await miijs.writeWiiBin(mii);
    console.log(miiBuffer);
    console.log(await miijs.readWiiBin(miiBuffer)?.meta?.name);
    res.setHeader('Content-Disposition', `attachment; filename="${req.query.id}.mii"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(miiBuffer);
});
// Change Email (User)
site.post('/changeEmail', async (req, res) => {
    try {
        if (!req.cookies.username || !req.cookies.token) {
            return res.json({ okay: false, msg: 'Not authenticated' });
        }

        if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
            return res.json({ okay: false, msg: 'Invalid token' });
        }

        const { oldEmail, newEmail } = req.body;
        const user = storage.users[req.cookies.username];

        // Verify old email matches
        if (user.email !== oldEmail) {
            return res.json({ okay: false, msg: 'Old email does not match' });
        }

        // Basic email validation
        if (!newEmail || !newEmail.includes('@') || !newEmail.includes('.')) {
            return res.json({ okay: false, msg: 'Invalid email format' });
        }

        user.email = newEmail;
        user.verified=false;
        var token = genToken();
        let link = "https://miis.kestron.com/verify?user=" + encodeURIComponent(req.body.username) + "&token=" + encodeURIComponent(token);
        user.verificationToken=hashPassword(token, hashed.salt).hash;
        save();

        makeReport(JSON.stringify({
            embeds: [{
                type: 'rich',
                title: '📧 Email Changed',
                description: `User ${req.cookies.username} changed their email`,
                color: 0x00CCFF,
                fields: [
                    {
                        name: 'User',
                        value: req.cookies.username,
                        inline: true
                    }
                ]
            }]
        }));

        sendEmail(oldEmail, "InfiniMii Verification", `Hi ${req.cookies.username}, we received a request to change your email on InfiniMii. If this was not you, please reply to this email to receive support.`);
        sendEmail(newEmail, "InfiniMii Verification", `Hi ${req.cookies.username}, we received a request to change your email on InfiniMii. Please verify your email by clicking this link: ${link}. If this was not you, please reply to this email to receive support.`);


        res.json({ okay: true });
    } catch (e) {
        console.error('Error changing email:', e);
        res.json({ okay: false, msg: 'Server error' });
    }
});

// Change Password (User)
site.post('/changePassword', async (req, res) => {
    try {
        if (!req.cookies.username || !req.cookies.token) {
            return res.json({ okay: false, msg: 'Not authenticated' });
        }

        if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
            return res.json({ okay: false, msg: 'Invalid token' });
        }

        const { oldPassword, newPassword } = req.body;
        const user = storage.users[req.cookies.username];

        // Verify old password
        if (!validatePassword(oldPassword, user.salt, user.pass)) {
            return res.json({ okay: false, msg: 'Old password is incorrect' });
        }

        // Hash new password with existing salt
        const newHashed = hashPassword(newPassword, user.salt);
        user.pass = newHashed.hash;

        // Generate new token and update cookie
        const newToken = genToken();
        user.token = hashPassword(newToken, user.salt).hash;

        save();

        // Set new token cookie
        res.cookie("token", newToken, { maxAge: 30 * 24 * 60 * 60 * 1000 });

        makeReport(JSON.stringify({
            embeds: [{
                type: 'rich',
                title: '🔒 Password Changed',
                description: `User ${req.cookies.username} changed their password`,
                color: 0x00FF00,
                fields: [
                    {
                        name: 'User',
                        value: req.cookies.username,
                        inline: true
                    }
                ]
            }]
        }));
        sendEmail(user.email,`Password Changed - InfiniMii`,`Hi ${req.cookies.username}, your password was recently changed on InfiniMii. If this was not you, you can reply to this email to receive support.`);

        res.json({ okay: true });
    } catch (e) {
        console.error('Error changing password:', e);
        res.json({ okay: false, msg: 'Server error' });
    }
});

// Delete All User's Miis (User - own miis only)
site.post('/deleteAllMyMiis', async (req, res) => {
    try {
        if (!req.cookies.username || !req.cookies.token) {
            return res.json({ okay: false, msg: 'Not authenticated' });
        }

        if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
            return res.json({ okay: false, msg: 'Invalid token' });
        }

        const user = storage.users[req.cookies.username];
        const miiIds = [...user.submissions];
        let deletedCount = 0;

        for (const miiId of miiIds) {
            try {
                const mii = storage.miis[miiId];
                if (mii) {
                    // Remove from miiIds
                    const index = storage.miiIds.indexOf(miiId);
                    if (index > -1) storage.miiIds.splice(index, 1);
                    
                    // Delete files
                    try { fs.unlinkSync(`./static/miiImgs/${miiId}.jpg`); } catch(e) {}
                    try { fs.unlinkSync(`./static/miiQRs/${miiId}.jpg`); } catch(e) {}
                    
                    // Delete Mii data
                    delete storage.miis[miiId];
                    deletedCount++;
                }
            } catch(e) {
                console.error(`Error deleting Mii ${miiId}:`, e);
            }
        }

        user.submissions = [];
        save();

        makeReport(JSON.stringify({
            embeds: [{
                type: 'rich',
                title: '🗑️ User Deleted All Their Miis',
                description: `${req.cookies.username} deleted all their own Miis`,
                color: 0xFF6600,
                fields: [
                    {
                        name: 'User',
                        value: req.cookies.username,
                        inline: true
                    },
                    {
                        name: 'Miis Deleted',
                        value: deletedCount.toString(),
                        inline: true
                    }
                ]
            }]
        }));
        sendEmail(user.email,`All Miis Deleted - InfiniMii`,`Hi ${req.cookies.username}, we received a request to delete all of your Miis. If this wasn't you, reply to this email to receive support.`);
        res.json({ okay: true, deletedCount });
    } catch (e) {
        console.error('Error deleting all user Miis:', e);
        res.json({ okay: false, msg: 'Server error' });
    }
});

// Delete Account (User)
site.post('/deleteAccount', async (req, res) => {
    try {
        if (!req.cookies.username || !req.cookies.token) {
            return res.json({ okay: false, msg: 'Not authenticated' });
        }

        if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
            return res.json({ okay: false, msg: 'Invalid token' });
        }

        const { password } = req.body;
        const username = req.cookies.username;
        const user = storage.users[username];

        // Verify password
        if (!validatePassword(password, user.salt, user.pass)) {
            return res.json({ okay: false, msg: 'Password is incorrect' });
        }

        // Transfer Miis to a special "Deleted User" account
        if (!storage.users["[Deleted User]"]) {
            storage.users["[Deleted User]"] = {
                salt: "",
                pass: "",
                creationDate: Date.now(),
                email: "",
                votedFor: [],
                submissions: [],
                miiPfp: "00000",
                roles: [ROLES.BASIC],
                moderator: false
            };
        }

        // Transfer all Miis to deleted user account
        user.submissions.forEach(miiId => {
            if (storage.miis[miiId]) {
                storage.miis[miiId].uploader = "[Deleted User]";
                storage.users["[Deleted User]"].submissions.push(miiId);
            }
        });

        // Delete user account
        delete storage.users[username];

        save();

        // Clear cookies
        res.clearCookie('username');
        res.clearCookie('token');

        makeReport(JSON.stringify({
            embeds: [{
                type: 'rich',
                title: '👋 Account Deleted',
                description: `User ${username} deleted their account`,
                color: 0xFF0000,
                fields: [
                    {
                        name: 'Username',
                        value: username,
                        inline: true
                    },
                    {
                        name: 'Miis Transferred',
                        value: user.submissions.length.toString(),
                        inline: true
                    }
                ]
            }]
        }));
        sendEmail(user.email,`Account Deleted - InfiniMii`,`Hi ${req.cookies.username}, we received a request to delete your account. We're sorry to see you go! If this wasn't you, please reply to this email to receive support.`)
        res.json({ okay: true });
    } catch (e) {
        console.error('Error deleting account:', e);
        res.json({ okay: false, msg: 'Server error' });
    }
});

site.get('/getInstructions', (req, res) => {
    try {
        const miiId = req.query.id;
        const format = req.query.format || '3ds'; // '3ds' or 'wii'
        const full = req.query.full === 'true';
        
        if (!storage.miis[miiId]) {
            res.json({ okay: false, error: 'Invalid Mii ID' });
            return;
        }
        
        let mii = storage.miis[miiId];
        
        // Convert to Wii format if requested
        if (format === 'wii') {
            mii = miijs.convertMii(mii, 'wii');
        }
        
        // Generate instructions
        const instructions = miijs.generateInstructions(mii, full);
        
        res.json({ 
            okay: true, 
            instructions: instructions,
            miiName: mii.meta.name,
            format: format
        });
        
    } catch (e) {
        console.error('Error generating instructions:', e);
        res.json({ okay: false, error: 'Failed to generate instructions: ' + e.message });
    }
});

site.post('/uploadMii', upload.single('mii'), async (req, res) => {
    try {
        let uploader = req.cookies.username;
        if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
            res.send("{'okay':false}");
            try { fs.unlinkSync("./uploads/" + req.file.filename); } catch (e) { }
            return;
        }
        const user = storage.users[uploader];
        
        // Check if trying to upload official Mii without permission
        if (req.body.official && !canUploadOfficial(user)) {
            res.send("{'error':'Only Researchers and Administrators can upload official Miis'}");
            try { fs.unlinkSync("./uploads/" + req.file.filename); } catch (e) { }
            return;
        }
        
        let mii;
        if (req.body.type === "wii") {
            mii = miijs.readWiiBin("./uploads/" + req.file.filename);
            mii = miijs.convertMii(mii, "3ds");
        }
        else if (req.body.type === "3ds") {
            mii = await miijs.read3DSQR("./uploads/" + req.file.filename);
        }
        else if (req.body.type === "3dsbin") {
            // Handle both encrypted and decrypted 3DS bins
            const binData = fs.readFileSync("./uploads/" + req.file.filename);
            
            // The read3DSQR function can handle both encrypted QR data and decrypted bin data
            // when passed as a buffer, so we just pass it directly
            try {
                mii = await miijs.read3DSQR(binData, false);
            } catch (error) {
                // If it fails, the bin format might be incompatible
                console.error("Error reading 3DS bin:", error);
                res.send("{'error':'Invalid 3DS bin format. Please ensure it is a valid encrypted or decrypted 3DS Mii binary.'}");
                try { fs.unlinkSync("./uploads/" + req.file.filename); } catch (e) { }
                return;
            }
        }
        else if (req.body.type === "3dsbin_direct") {
            // Handle binary data passed directly (from QR scanner)
            mii = await miijs.read3DSQR(req.body["3dsbin"]);
        }
        else {
            res.send("{'error':'No valid type specified'}");
            try { fs.unlinkSync("./uploads/" + req.file.filename); } catch (e) { }
            return;
        }
        
        mii.id = genId();
        mii.uploadedOn = Date.now();
        
        // Render images
        await miijs.renderMii(mii, "./static/miiImgs/" + mii.id + ".png");
        await miijs.write3DSQR(mii, "./static/miiQRs/" + mii.id + ".png");
        
        mii.uploader = req.body.official ? "Nintendo" : uploader;
        mii.desc = req.body.desc;
        mii.votes = 1;
        mii.official = req.body.official;
        
        storage.miis[mii.id] = mii;
        storage.miiIds.push(mii.id);
        storage.users[req.body.official ? "Nintendo" : uploader].submissions.push(mii.id);
        save();
        
        setTimeout(() => { res.redirect("/mii?id=" + mii.id) }, 2000); // To ensure the QR code is generated
        
        var d = new Date();
        makeReport(JSON.stringify({
            embeds: [{
                "type": "rich",
                "title": (req.body.official ? "Official " : "") + "Mii Uploaded",
                "description": "**" + mii.meta.name + "** uploaded by **" + uploader + "**",
                "color": 0x25d366,
                "thumbnail": {
                    "url": "https://infinimii.kestron.com/miiImgs/" + mii.id + ".png",
                    "height": 0,
                    "width": 0
                },
                "footer": {
                    "text": d.toDateString() + " " + d.toTimeString()
                }
            }]
        }));
        
    } catch (e) {
        console.error("Error uploading Mii:", e);
        res.send("{'error':'There was an error uploading your Mii - make sure you selected the right Mii type'}");
        try { fs.unlinkSync("./uploads/" + req.file.filename); } catch (err) { }
    }
    
    try { fs.unlinkSync("./uploads/" + req.file.filename); } catch (e) { }
});
site.post('/convertMii', upload.single('mii'), async (req, res) => {
    try {
        let mii;
        if (req.body.fromType === "3DS/Wii U") {
            mii = await miijs.read3DSQR("./uploads/" + req.file.filename);
        }
        if (req.body.fromType === "3DS Bin") {
            mii = await miijs.read3DSQR(req.body["3dsbin"]);
        }
        if (req.body.fromType === "Wii") {
            mii = miijs.readWiiBin("./uploads/" + req.file.filename);
        }
        if (req.body.fromType.includes("3DS") && req.body.toType.includes("Wii Mii")) {
            mii = miijs.convertMii(mii, "3ds");
        }
        if (req.body.fromType === "Wii" && req.body.toType.includes("3DS")) {
            mii = miijs.convertMii(mii, "wii");
        }
        if (req.body.toType.includes("Special")) {
            mii.info.type = "Special";
        }
        else {
            mii.info.type = "Normal";
        }
        try { fs.unlinkSync("./uploads/" + req.file.filename); } catch (e) { }
        if (req.body.toType.includes("Wii Mii")) {
            await miijs.writeWiiBin(mii, "./" + mii.name + ".mii");
            res.setHeader('Content-Disposition', `attachment; filename="${mii.name}.mii"`);
            await res.sendFile("./" + mii.name + ".mii", { root: path.join(__dirname, "./") });
            setTimeout(() => {
                fs.unlinkSync("./" + mii.name + ".mii");
            }, 2000);
            return;
        }
        if (req.body.toType.includes("3DS")) {
            await miijs.write3DSQR(mii, "./static/converted/" + mii.name + ".png");
            setTimeout(() => {
                res.redirect("/converted/" + mii.name + ".png");
            }, 5000);
            setTimeout(() => {
                fs.unlinkSync("./static/converted/" + mii.name + ".png");
            }, 10000);
            return;
        }
    }
    catch (e) {
        console.log(e);
        res.send("{'okay':false}");
    }
});
site.post('/signup', (req, res) => {
    if (storage.users[req.body.username] || !validate(req.body.username)) {
        res.send("Username Invalid");
        return;
    }
    
    // Check IP ban
    const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const ipHash = hashIP(clientIP);
    if (storage.bannedIPs.includes(ipHash)) {
        return res.send('This IP address has been permanently banned from creating accounts.');
    }
    
    var hashed = hashPassword(req.body.pass);
    var token = genToken();
    storage.users[req.body.username] = {
        salt: hashed.salt,
        pass: hashed.hash,
        verificationToken: hashPassword(token, hashed.salt).hash,
        creationDate: Date.now(),
        email: req.body.email,
        votedFor: [],
        submissions: [],
        miiPfp: "00000",
        roles: [ROLES.BASIC],
        moderator: false
    };
    
    let link = "https://miis.kestron.com/verify?user=" + encodeURIComponent(req.body.username) + "&token=" + encodeURIComponent(token);
    sendEmail(req.body.email, "InfiniMii Verification", "Welcome to InfiniMii! Please verify your email by clicking this link: " + link);
    res.send("Check your email to verify your account!");
    save();
});
site.post('/login', (req, res) => {
    if (storage.users[req.body.username].pass === validatePassword(req.body.pass, storage.users[req.body.username].salt), storage.users[req.body.username].pass) {
        if (storage.users[req.body.username].verified) {
            var token = genToken();
            storage.users[req.body.username].token = hashPassword(token, storage.users[req.body.username].salt).hash;
            res.cookie('token', token, { maxAge: 30 * 24 * 60 * 60 * 1000/*1 Month*/ });
            res.cookie('username', req.body.username, { maxAge: 30 * 24 * 60 * 60 * 1000/*1 Month*/ });
        }
        else {
            res.send("Email not verified yet");
            return;
        }
    }
    res.redirect("/");
    save();
});

setInterval(() => {
    var curTime = new Date();
    if (curTime.getHours() === 22 && storage.highlightedMiiChangeDay !== curTime.getDay()) {
        makeReport("**Don't forget to set a new Highlighted Mii!**");
    }
}, 1000 * 60 * 60);