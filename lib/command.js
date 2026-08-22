var util	= require('util'),
	extend  = require('extend'),
	response= require('./response');

var Command = function(cmd, args, cb){
	this.cmd = cmd || "INVA";
	if(typeof args!=='object' && typeof args!=='undefined' && args!==null){
		args = [args];
	}
	this.args = args;
	this.cb = cb;
}

Command.prototype.toString = function(){
	var str = this.cmd;

	if(this.args){
		for(var i=0; i<this.args.length; i++){
			str += ' ' + this.args[i];
		}
	}

	return str;
}

// Baut die vollständige Zeile für die Leitung, inklusive Klassen-Header.
// Die Klasse hängt am Befehl, nicht an der Verbindung: Class-1- und
// Class-2-Befehle laufen über dieselbe Verbindung. Wer kein `cls` setzt,
// bekommt die Klasse der Verbindung — deshalb ändert sich für alle
// bestehenden Befehle nichts.
Command.prototype.toWire = function(fallbackCls){
	return '%' + (this.cls || fallbackCls) + this.toString();
}

Command.prototype.handleResponse = function(resp){
	//no callback, so return
	if(!this.cb) return;
	
	if(resp.isError()){
		this.cb(resp.getError());
		return;
	}

	if(resp.cmd!=this.cmd){
		this.cb(response.getError(response.ERRORS.ERRM));
		return;
	}

	if(!resp.hasArgs()){
		this.cb();
		return;
	}


	var args = this.formatResult(resp.getArgs());
	if(util.isArray(args)){
		args.unshift(null);
	}else{
		args = [null, args];
	}

	this.cb.apply(null, args);
}

Command.prototype.formatResult = function(args){
	return args;
}

/************* POWER ************/
Command.POWER = {
	OFF: 0, ON: 1, COOLING_DOWN: 2, WARMING_UP: 3,
	STANDBY: 0
}

Command.PowerCommand = function(){
	var cb;
	var data = '?';
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	if(args.length>0){
		data = args.shift();
	}
	
	Command.call(this, 'POWR', data, cb);
}

util.inherits(Command.PowerCommand, Command);

Command.PowerCommand.prototype.formatResult = function(args){
	if(args.length>0){
		return parseInt(args[0]);
	}
}


/************* INPUT ************/
Command.INPUT = {
	RGB: 1, VIDEO: 2, DIGITAL: 3, STORAGE: 4, NETWORK: 5
}

Command.InputCommand = function(){
	var cb;
	var data = '?';
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();
	
	if(args.length>0){
		var input = {source: 'rgb', channel: 1}

		if(typeof args[0]=='object'){
			input = extend(input, args[0]);
		}else if(typeof args[0]=='string' && args[0].length==2){ //string code
			input.source = parseInt(args[0].substr(0,1));
			input.channel = parseInt(args[0].substr(1,1));
		}else if(typeof args[0]=='number' && args[0]>=10){ //number code
			input.channel = args[0]%10;
			input.source = (args[0]-input.channel)/10;
		}else{
			input.source = args.shift();
			if(args.length) input.channel = args.shift();
		}

		if(typeof input.source==='string'){
			input.source = Command.INPUT[input.source.toUpperCase()];
		}

		data = input.source + '' + input.channel;

	}

	Command.call(this, 'INPT', data, cb);
}
util.inherits(Command.InputCommand, Command);

Command.InputCommand.prototype.formatResult = function(args){
	if(args.length>0){
		args = args[0];
		if(typeof args==='string' && args.length>1){
			try{
				var source = parseInt(args.substr(0,1));
				var channel = parseInt(args.substr(1,1));
				return {source: source, channel: channel, code: args, name: findSourceName(source, channel)};
			}catch(e){}
		}
	}
}

var findSourceName = function(source, channel){
	for(var key in Command.INPUT){
		if(Command.INPUT[key]==source){
			return key + ' - ' + channel;
		}
	}

	return 'unknown';
}

/************* MUTE ************/

Command.MuteCommand = function(){
	var cb;
	var data = '?';
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	if(args.length>0){
		var mute = {audio: false, video: false};

		if(typeof args[0]=='object'){
			mute = extend(mute, args[0]);
		}else{
			mute.video = args.shift();
			if(args.length) mute.audio = args.shift();
		}

		//if both the same
		if(mute.audio==mute.video){
			if(mute.audio){
				data = '31';
			}else{
				data = '30';
			}
		}else{
			if(mute.video){
				data = '11';
			}else{
				data = '21';
			}
		}
	}

	Command.call(this, 'AVMT', data, cb);
}

util.inherits(Command.MuteCommand, Command);

Command.MuteCommand.prototype.formatResult = function(args){
	var mute = {audio: false, video: false}
	if(args.length>0){
		args = args[0];
		if(typeof args==='string' && args.length>1){

			var c = args.substr(0,1);
			var v = (args.substr(1,1)=='1');

			switch(c){
				case '1':
					mute.video = v;
					break;
				case '2':
					mute.audio = v;
					break;
				case '3':
					mute.video = mute.audio = v;
					break;
			}
		}
	}
	return mute;
}

/************* ERRORS ************/

Command.ErrorsCommand = function(){
	var cb;
	var data = '?';
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	Command.call(this, 'ERST', data, cb);
}

util.inherits(Command.ErrorsCommand, Command);

Command.ErrorsCommand.prototype.formatResult = function(args){
	if(args.length>0){
		args = args[0];
		if(typeof args==='string' && args.length==6){
			if(parseInt(args)!=0){
				var err = {
					fan: args.substr(0,1),
					lamp: args.substr(1,1),
					temperature: args.substr(2,1),
					cover: args.substr(3,1),
					filter: args.substr(4,1),
					other: args.substr(5,1)
				}
				for(k in err){
					if(err.hasOwnProperty(k)){
						err[k] = (err[k]=='2'?'error':(err[k]=='1')?'warning':false);
					}
				}
				return err;
			}
		}
	}
	return null;
}

/************* LAMP ************/

Command.LampCommand = function(){
	var cb;
	var data = '?';
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	Command.call(this, 'LAMP', data, cb);
}

util.inherits(Command.LampCommand, Command);

Command.LampCommand.prototype.formatResult = function(args){
	var lamps = [];

	if(args.length>0 && args.length%2==0){
		for(var i=0; i<args.length; i+=2){
			var lamp = {
				hours: parseInt(args[i]),
				on: (args[i+1]=='1')
			}
			lamps.push(lamp);
		}
	}

	return [lamps];
}

/************* INPUTS ************/

Command.InputsCommand = function(){
	var cb;
	var data = '?';
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	Command.call(this, 'INST', data, cb);
}

util.inherits(Command.InputsCommand, Command);

Command.InputsCommand.prototype.formatResult = function(args){
	var inputs = [];

	for(var i=0; i<args.length; i++){
		var input = args[i];
		if(typeof input==='string' && input.length>1){
			try{
				var source = parseInt(input.substr(0,1));
				var channel = parseInt(input.substr(1,1));
				inputs.push(
					{source: source, channel: channel, code: input, name: findSourceName(source, channel)}
				);
			}catch(e){}
		}
	}

	return [inputs];
}

/************* Name ************/

Command.NameCommand = function(){
	var cb;
	var data = '?';
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	Command.call(this, 'NAME', data, cb);
}

util.inherits(Command.NameCommand, Command);

/************* MANUFACTURER ************/

Command.ManufacturerCommand = function(){
	var cb;
	var data = '?';
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	Command.call(this, 'INF1', data, cb);
}

util.inherits(Command.ManufacturerCommand, Command);

/************* MODEL ************/

Command.ModelCommand = function(){
	var cb;
	var data = '?';
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	Command.call(this, 'INF2', data, cb);
}

util.inherits(Command.ModelCommand, Command);

Command.ModelCommand.prototype.formatResult = function(args) {
    return args.join(" ");
}

/************* INFO ************/

Command.InfoCommand = function(){
	var cb;
	var data = '?';
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	Command.call(this, 'INFO', data, cb);
}

util.inherits(Command.InfoCommand, Command);

/*****************************************************************
 *  Ab hier: PJLink Class 2.
 *  Alle Befehle setzen `cls = 2` und gehen dadurch mit dem Header
 *  %2 auf die Leitung — unabhängig von der Klasse der Verbindung.
 *****************************************************************/

/************* VOLUME (SVOL / MVOL) ************/

Command.VOLUME = { DOWN: 0, UP: 1 };

// PJLink kennt bei der Lautstärke nur "eine Stufe hoch" und "eine Stufe
// runter". Einen Ist-Wert gibt es nicht — das ist so festgelegt, kein Mangel.
var richtungWert = function(wert){
	if(wert===Command.VOLUME.UP || wert===true) return 1;
	if(wert===Command.VOLUME.DOWN || wert===false) return 0;
	if(typeof wert==='string'){
		if(wert.toLowerCase()==='up') return 1;
		if(wert.toLowerCase()==='down') return 0;
	}
	throw new Error('Richtung fehlt: erlaubt sind up und down');
}

var volumeTeile = function(cmd, args){
	var cb;
	args = Array.prototype.slice.call(args, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	return {cmd: cmd, data: richtungWert(args.shift()), cb: cb};
}

Command.SVOLCommand = function(){
	var c = volumeTeile('SVOL', arguments);
	Command.call(this, c.cmd, c.data, c.cb);
	this.cls = 2;
}

util.inherits(Command.SVOLCommand, Command);

Command.MVOLCommand = function(){
	var c = volumeTeile('MVOL', arguments);
	Command.call(this, c.cmd, c.data, c.cb);
	this.cls = 2;
}

util.inherits(Command.MVOLCommand, Command);

/************* FREEZE ************/

Command.FreezeCommand = function(){
	var cb;
	var data = '?';
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	if(args.length>0) data = args.shift() ? 1 : 0;

	Command.call(this, 'FREZ', data, cb);
	this.cls = 2;
}

util.inherits(Command.FreezeCommand, Command);

Command.FreezeCommand.prototype.formatResult = function(args){
	// Auf einen Schaltbefehl antwortet der Beamer mit OK. Das ist keine
	// Zustandsmeldung — daraus darf kein "Standbild ist aus" werden.
	if(args.length>0){
		if(args[0]==='1') return true;
		if(args[0]==='0') return false;
	}
}

/************* SERIAL NUMBER ************/

// Antworten dieser Abfragen dürfen Leerzeichen enthalten. Der Zerleger in
// response.js trennt daran — hier wird der Text wieder zusammengesetzt.
var alsText = function(args){
	return args.join(' ');
}

Command.SerialNumberCommand = function(){
	var cb;
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	Command.call(this, 'SNUM', '?', cb);
	this.cls = 2;
}

util.inherits(Command.SerialNumberCommand, Command);

Command.SerialNumberCommand.prototype.formatResult = alsText;

/************* SOFTWARE VERSION ************/

Command.SoftwareVersionCommand = function(){
	var cb;
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	Command.call(this, 'SVER', '?', cb);
	this.cls = 2;
}

util.inherits(Command.SoftwareVersionCommand, Command);

Command.SoftwareVersionCommand.prototype.formatResult = alsText;

/************* INPUT NAME ************/

// Der einzige Abfragebefehl mit Parameter: %2INNM ?31 fragt nach dem Namen
// eines bestimmten Eingangs. Ein blankes "?" beantwortet kein Beamer.
Command.InputNameCommand = function(){
	var cb;
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	var code = args.shift();
	if(typeof code!=='string' || code.length!==2){
		throw new Error('Eingang fehlt: erwartet wird eine zweistellige Kennung wie 31');
	}

	Command.call(this, 'INNM', '?'+code, cb);
	this.cls = 2;
}

util.inherits(Command.InputNameCommand, Command);

Command.InputNameCommand.prototype.formatResult = alsText;

/************* RESOLUTION (IRES / RRES) ************/

// "1920x1080" wird zerlegt. "-" (kein Signal) und "*" (Signal nicht
// einzuordnen) sind gültige Antworten und bleiben als Kennung erhalten —
// was daraus in Klartext wird, entscheidet die Anwendung, nicht das Protokoll.
var alsAufloesung = function(args){
	if(args.length===0) return null;

	var code = args[0];
	var teile = /^(\d+)x(\d+)$/.exec(code);

	if(!teile) return {code: code, width: null, height: null};

	return {code: code, width: parseInt(teile[1]), height: parseInt(teile[2])};
}

Command.InputResolutionCommand = function(){
	var cb;
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	Command.call(this, 'IRES', '?', cb);
	this.cls = 2;
}

util.inherits(Command.InputResolutionCommand, Command);

Command.InputResolutionCommand.prototype.formatResult = alsAufloesung;

Command.RecommendResolutionCommand = function(){
	var cb;
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	Command.call(this, 'RRES', '?', cb);
	this.cls = 2;
}

util.inherits(Command.RecommendResolutionCommand, Command);

Command.RecommendResolutionCommand.prototype.formatResult = alsAufloesung;

/************* FILTER USAGE ************/

// Achtung, anders als LAMP: FILT liefert einen einzelnen Wert — die
// aufsummierten Betriebsstunden des Filters. Keine Paare aus Stunden und
// Zustand, die zu zerlegen wären.
Command.FilterUsageCommand = function(){
	var cb;
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	Command.call(this, 'FILT', '?', cb);
	this.cls = 2;
}

util.inherits(Command.FilterUsageCommand, Command);

Command.FilterUsageCommand.prototype.formatResult = function(args){
	if(args.length>0) return parseInt(args[0]);
}

/************* REPLACEMENT PARTS (RLMP / RFIL) ************/

// Modellnummern der Ersatzteile, durch Leerzeichen getrennt — bei mehreren
// Lampen mehrere Nummern. Geräte ohne Wechsellampe (Laser) antworten leer;
// daraus wird eine leere Liste, kein Fehler.
var alsTeileliste = function(args){
	return [args.slice()];
}

Command.LampReplacementCommand = function(){
	var cb;
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	Command.call(this, 'RLMP', '?', cb);
	this.cls = 2;
}

util.inherits(Command.LampReplacementCommand, Command);

Command.LampReplacementCommand.prototype.formatResult = alsTeileliste;

Command.FilterReplacementCommand = function(){
	var cb;
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	Command.call(this, 'RFIL', '?', cb);
	this.cls = 2;
}

util.inherits(Command.FilterReplacementCommand, Command);

Command.FilterReplacementCommand.prototype.formatResult = alsTeileliste;

/************* CLASS ************/

Command.ClassCommand = function(){
	var cb;
	var data = '?';
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	Command.call(this, 'CLSS', data, cb);
}

util.inherits(Command.ClassCommand, Command);

// Die Spezifikation sieht auf %1CLSS ? nur die nackte Ziffer vor ("1"/"2").
// Nicht alle Geräte halten sich daran: Optoma antwortet "Class 1" — an einem
// echten Gerät nachgemessen. Weil response.js am Leerzeichen zerlegt, kommt
// so eine Antwort als mehrere Teile an; wer eine einzelne Ziffer erwartet,
// steht bei diesen Geräten mit leeren Händen da.
// Deshalb wird die Ziffer aus der Antwort gelesen, statt sie vorauszusetzen.
// Der Wortlaut bleibt erhalten, damit im Protokoll nachvollziehbar ist, was
// das Gerät wirklich gesagt hat.
Command.ClassCommand.prototype.formatResult = function(args){
	var raw = args.join(' ');
	var treffer = /\d/.exec(raw);
	var cls = treffer ? parseInt(treffer[0], 10) : null;

	// PJLink kennt nur Class 1 und 2. Alles andere ist keine Klassenangabe.
	if(cls!==1 && cls!==2) cls = null;

	return {cls: cls, raw: raw};
}


module.exports = Command;
