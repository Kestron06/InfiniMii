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

const header=`<header>
				<a href="/"><img src='banner.png' id="banner"></a>
			</header>`;
const footer=``;

function objCopy(obj) {
	return JSON.parse(JSON.stringify(obj));
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
function api(what,arg2){
	var newArr;
	switch(what){
		case "all":
			return storage.miis;
		break;
		case "miiOfDay":
			return storage.miis[storage.miiOfDay];
		break;
		case "getMii":
			return storage.miis[arg2];
		break;
		case "topMiis":
			newArr = Object.values(storage.miis);
			newArr.sort((a, b) => {
				return wilsonMethod(b.votes, b.uploadedOn) - wilsonMethod(a.votes, a.uploadedOn);
			});
			return newArr;
		break;
		case "best":
			newArr = Object.values(storage.miis);
			newArr.sort((a, b) => {
				return b.votes - a.votes;
			});
			return newArr;
		break;
		case "recent":
			newArr=Object.values(storage.miis);
			newArr.sort((a, b) => {
				return b.uploadedOn - a.uploadedOn;
			});
			return newArr;
		break;
		case "official":
			newArr = Object.values(storage.miis).filter(mii=>{
				return mii.official;
			});
			newArr.sort((a, b) => {
				return b.votes - a.votes;
			});
			return newArr;
		break;
		case "search":
			arg2 = arg2.toLowerCase();
			newArr = Object.values(storage.miis).filter(mii=>{
				return mii.name.toLowerCase().includes(arg2)||mii.desc.toLowerCase().includes(arg2)||mii.uploader.toLowerCase().includes(arg2);
			});
			//Needs to sort by relevancy at some point
			newArr.sort((a, b) => {
				return b.votes - a.votes;
			});
			return newArr;
		break;
		default:
			return `{"okay":false,"error":"No valid type specified"}`
		break;
	}
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
			user: "notifications@kestron.software",
			pass: process.env["emailPass"]
		}
	}).sendMail({
		from: "notifications@kestron.software",
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

const site = new express();
site.use(express.urlencoded({ extended: true }));
site.use(express.static(path.join(__dirname + '/static')));
site.use(cookieParser());
site.use('/favicon.ico', express.static('static/favicon.png'));
site.listen(8080, () => {
	console.log("Online");
});
//The following up to and including /recent are all sorted before being renders in miis.ejs, meaning the file is recycled. / is currently just a clone of /top. /official and /search is more of the same but with a slight change to make Mii of the Day still work without the full Mii array
site.get('/', (req, res) => {
	var user = req.cookies.username || "default";
	let toSend = Object.assign({}, storage, { thisUser: user, pfp: storage.users[user].miiPfp });
	toSend.miis = api("topMiis");
	toSend.miiOfDay = storage.miis[storage.miiOfDay];
	toSend.title = "InfiniMii";
	toSend.header=header;
	toSend.footer=footer;
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
	var user = req.cookies.username || "default";
	let toSend = Object.assign({}, storage, { thisUser: user, pfp: storage.users[user].miiPfp });
	toSend.miis = api("topMiis");
	toSend.miiOfDay = storage.miis[storage.miiOfDay];
	toSend.title = "Top Miis - InfiniMii";
	toSend.header=header;
	toSend.footer=footer;
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
	var user = req.cookies.username || "default";
	let toSend = Object.assign({}, storage, { thisUser: user, pfp: storage.users[user].miiPfp });
	toSend.miis = api("best");
	toSend.miiOfDay = storage.miis[storage.miiOfDay];
	toSend.title = "All-Time Top Miis - InfiniMii";
	toSend.header=header;
	toSend.footer=footer;
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
	var user = req.cookies.username || "default";
	let toSend = Object.assign({}, storage, { thisUser: user, pfp: storage.users[user].miiPfp });
	toSend.miis = api("recent");
	toSend.miiOfDay = storage.miis[storage.miiOfDay];
	toSend.title = "Recent Miis - InfiniMii";
	toSend.header=header;
	toSend.footer=footer;
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
	var user = req.cookies.username || "default";
	let toSend = Object.assign({}, storage, { thisUser: user, pfp: storage.users[user].miiPfp });
	toSend.miis = api("official");
	toSend.miiOfDay = storage.miis[storage.miiOfDay];
	toSend.title = "Official Miis - InfiniMii";
	toSend.header=header;
	toSend.footer=footer;
	ejs.renderFile('./ejsFiles/otherMiis.ejs', toSend, {}, function(err, str) {
		if (err) {
			res.send(err);
			console.log(err);
			return;
		}
		res.send(str)
	});
});
site.get('/searchResults', (req, res) => {
	var user = req.cookies.username || "default";
	let toSend = Object.assign({}, storage, { thisUser: user, pfp: storage.users[user].miiPfp });
	toSend.miis = api("search",req.query.q);
	toSend.miiOfDay = storage.miis[storage.miiOfDay];
	toSend.title = "Search '" + req.query.q + "' - InfiniMii";
	toSend.header=header;
	toSend.footer=footer;
	ejs.renderFile('./ejsFiles/otherMiis.ejs', toSend, {}, function(err, str) {
		if (err) {
			res.send(err);
			console.log(err);
			return;
		}
		res.send(str)
	});
});
site.get('/search', (req, res) => {
	ejs.renderFile('./ejsFiles/search.ejs', Object.assign({}, storage, { thisUser: (req.cookies.username || "default"), pfp: storage.users[(req.cookies.username || "default")].miiPfp }, {header:header,footer:footer}), {}, function(err, str) {
		if (err) {
			res.send(err);
			console.log(err);
			return;
		}
		res.send(str)
	});
});
site.get('/upload', (req, res) => {
	ejs.renderFile('./ejsFiles/upload.ejs', Object.assign({}, storage, { thisUser: (req.cookies.username || "default"), pfp: storage.users[(req.cookies.username || "default")].miiPfp }, {header:header,footer:footer}), {}, function(err, str) {
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
		if (storage.users[req.cookies.username].submissions.includes(req.query.id) || storage.users[req.cookies.username].moderator) {
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
							"value": `[${mii.uploader}](https://miis.kestron.software/user?user=${mii.uploader})`,
							"inline": true
						},
						{
							"name": `Mii Creator Name (embedded in Mii file)`,
							"value": mii.creatorName,
							"inline": true
						}
					],
					"thumbnail": {
						"url": `https://miis.kestron.software/miiImgs/${mii.id}.png`,
						"height": 0,
						"width": 0
					},
					"footer": {
						"text": `Deleted at ${d.getHours()}:${d.getMinutes()}, ${d.toDateString()} UTC`
					}
				}]
			}));
			storage.miiIds.splice(storage.miiIds.indexOf(req.query.id), 1);
			delete storage.miis[req.query.id];
			fs.unlinkSync("./static/miiImgs/" + req.query.id + ".png");
			fs.unlinkSync("./static/miiQRs/" + req.query.id + ".png");
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
	let inp = Object.assign({}, storage, { thisUser: (req.cookies.username || "default"), pfp: storage.users[(req.cookies.username || "default")].miiPfp });
	inp.mii = storage.miis[req.query.id];
	inp.header=header;
	inp.footer=footer;
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
	let inp = Object.assign({}, storage, { thisUser: (req.cookies.username || "default"), pfp: storage.users[(req.cookies.username || "default")].miiPfp });
	inp.user = storage.users[req.query.user];
	inp.user.name = req.query.user;
	inp.miis = [];
	storage.users[req.query.user].submissions.forEach(mii => {
		inp.miis.push(storage.miis[mii]);
	});
	inp.header=header;
	inp.footer=footer;
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
	ejs.renderFile('./ejsFiles/convert.ejs', Object.assign({}, storage, { thisUser: (req.cookies.username || "default"), pfp: storage.users[(req.cookies.username || "default")].miiPfp },{header:header,footer:footer}), {}, function(err, str) {
		if (err) {
			res.send(err);
			console.log(err);
			return;
		}
		res.send(str)
	});
});
site.get('/qr', (req, res) => {
	ejs.renderFile('./ejsFiles/qr.ejs', Object.assign({}, storage, { thisUser: (req.cookies.username || "default"), pfp: storage.users[(req.cookies.username || "default")].miiPfp },{header:header,footer:footer}), {}, function(err, str) {
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
	ejs.renderFile('./ejsFiles/settings.ejs', Object.assign({}, storage, { thisUser: req.cookies.username, pfp: storage.users[req.cookies.username].miiPfp}, {header:header,footer:footer}), {}, function(err, str) {
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
					"url": `https://miis.kestron.software/miiImgs/${storage.users[req.query.newUser].miiPfp}.png`,
					"height": 0,
					"width": 0
				},
				"footer": {
					"text": `Changed at ${d.getHours()}:${d.getMinutes()}, ${d.toDateString()} UTC`
				},
				"url": `https://miis.kestron.software/user?user=${req.query.newUser}`
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
site.get('/changeMiiOfDay', (req, res) => {
	if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token) || !storage.users[req.cookies.username].moderator) {
		res.send(`{"okay":false,"msg":"Invalid account"}`);
		return;
	}
	if (req.query.id?.length > 0 && storage.miiIds.includes(req.query.id)) {
		storage.miiOfDay = req.query.id;
		res.send(`{"okay":true}`);
		var mii = storage.miis[storage.miiOfDay];
		storage.miiOfDayChangeDay = new Date().getDate();
		makeReport(JSON.stringify({
			embeds: [{
				"type": "rich",
				"title": (mii.official ? "Official " : "") + `Mii set as Mii of the Day`,
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
						"value": `[${mii.uploader}](https://miis.kestron.software/user?user=${mii.uploader})`,
						"inline": true
					},
					{
						"name": `Mii Creator Name (embedded in Mii file)`,
						"value": mii.creatorName,
						"inline": true
					}
				],
				"thumbnail": {
					"url": `https://miis.kestron.software/miiImgs/${mii.id}.png`,
					"height": 0,
					"width": 0
				},
				"footer": {
					"text": `New Mii of the Day set by ${req.cookies.username}`
				},
				"url": `https://miis.kestron.software/mii?id=` + mii.id
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
					"value": `[${mii.uploader}](https://miis.kestron.software/user?user=${mii.uploader})`,
					"inline": true
				},
				{
					"name": `Mii Creator Name (embedded in Mii file)`,
					"value": mii.creatorName,
					"inline": true
				}
			],
			"thumbnail": {
				"url": `https://miis.kestron.software/miiImgs/${mii.id}.png`,
				"height": 0,
				"width": 0
			},
			"footer": {
				"text": `Mii has been reported by ${req.cookies.username?req.cookies.username:"Anonymous"}`
			},
			"url": `https://miis.kestron.software/mii?id=` + mii.id
		}]
	}));
	res.send(`{"okay":true}`);
});
site.get('/miiWii',(req,res)=>{
	var mii=miijs.convertMii(storage.miis[req.query.id],"3ds");
	miijs.writeWiiBin(mii,"./static/"+req.query.id+".mii");
	res.set('Content-Disposition', `attachment; filename="${req.query.id}.mii"`);
	res.sendFile(path.join(__dirname,"./static/"+req.query.id+".mii"));
	setTimeout(()=>{fs.unlinkSync("./static/"+req.query.id+".mii")},2000);
});
site.post('/uploadMii', upload.single('mii'), async (req, res) => {
	try {
		let uploader = req.cookies.username;
		if (!validatePassword(req.cookies.token, storage.users[req.cookies.username].salt, storage.users[req.cookies.username].token)) {
			res.send("{'okay':false}");
			try { fs.unlinkSync("./uploads/" + req.file.filename); } catch (e) { }
			return;
		}
		let mii;
		if (req.body.type === "wii") {
			mii = miijs.convertMii(miijs.readWiiBin("./uploads/" + req.file.filename), "wii");
		}
		else if (req.body.type === "3ds") {
			mii = await miijs.read3DSQR("./uploads/" + req.file.filename);
		}
		else if (req.body.type === "3dsbin") {
			mii = await miijs.read3DSQR(req.body["3dsbin"]);
		}
		else {
			res.send("{'error':'No valid type specified'}");
			try { fs.unlinkSync("./uploads/" + req.file.filename); } catch (e) { }
			return;
		}
		mii.id = genId();
		mii.uploadedOn = Date.now();
		miijs.render3DSMiiFromJSON(mii, "./static/miiImgs/" + mii.id + ".png");
		miijs.write3DSQR(mii, "./static/miiQRs/" + mii.id + ".png");
		mii.uploader = req.body.official ? "Nintendo" : uploader;
		mii.desc = req.body.desc;
		mii.votes = 1;
		mii.official = req.body.official;
		storage.miis[mii.id] = mii;
		storage.miiIds.push(mii.id);
		storage.users[req.body.official ? "Nintendo" : uploader].submissions.push(mii.id);
		setTimeout(() => { res.redirect("/mii?id=" + mii.id) }, 2000);//To ensure the QR code is generated
		var d = new Date();
		makeReport(JSON.stringify({
			embeds: [{
				"type": "rich",
				"title": (req.body.official ? "Official " : "") + `Mii Uploaded`,
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
						"value": `[${uploader}](https://miis.kestron.software/user?user=${uploader})`,
						"inline": true
					},
					{
						"name": `Mii Creator Name (embedded in Mii file)`,
						"value": mii.creatorName,
						"inline": true
					}
				],
				"thumbnail": {
					"url": `https://miis.kestron.software/miiImgs/${mii.id}.png`,
					"height": 0,
					"width": 0
				},
				"footer": {
					"text": `Uploaded at ${d.getHours()}:${d.getMinutes()}, ${d.toDateString()} UTC`
				},
				"url": `https://miis.kestron.software/mii?id=` + mii.id
			}]
		}));
		save();
	}
	catch (e) {
		try {
			console.log(e);
			res.send("Whoops! There was an error - make sure you selected the right Mii type");
		} catch (e) { }
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
	if (storage.users[req.body.username] || !validate(req.query.newUser)) {
		res.send("Username Invalid");
		return;
	}
	var hashed = hashPassword(req.body.pass);
	var token = genToken();
	storage.users[req.body.username] = {
		salt: hashed.salt,
		pass: hashed.hash,
		verificationToken: hashPassword(token, hashed.salt).hash,
		creationDate: Date.now(),
		email: hashPassword(req.body.email, hashed.salt).hash,
		votedFor: [],
		submissions: [],
		miiPfp: "W1LfG"
	};
	let link = "https://miis.kestron.software/verify?user=" + encodeURIComponent(req.body.username) + "&token=" + encodeURIComponent(token);
	sendEmail(req.body.email, "InfiniMii Verification", "Welcome to InfiniMii! Click here to finish signing up!<br>" + link + "<br>*Clicking this link will set a browser cookie to keep you logged in");
	res.redirect("/");
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
	if (curTime.getHours() === 22 && miiOfDayChangeDay !== curTime.getDay()) {
		makeReport("**Don't forget to set a new Mii of the Day!**");
	}
}, 1000 * 60 * 60);