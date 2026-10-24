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

// Builds the complete line for the wire, class header included.
// The class belongs to the command, not to the connection: Class 1 and
// Class 2 commands run over the same connection. Anything that does not set
// `cls` gets the connection's class — which is why nothing changes for the
// commands that were here before.
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
	if(Array.isArray(args)){
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
// An input is named by two characters: the kind of connector, and which one of
// them. Class 1 numbers them 11 to 59; Class 2 added INTERNAL as a sixth kind
// and widened the second character to "1-9 and A~Z" (spec 4.3), so the codes
// run 11 to 6Z.
//
// Hence the second character is kept as a character. Read as a number, HDMI-A
// becomes "3NaN" on the wire — and a command that does not meet the format
// requirements is one a projector answers with silence rather than an error
// (spec 6, Response method), which looks exactly like a projector that is not
// there.
Command.INPUT = {
	RGB: 1, VIDEO: 2, DIGITAL: 3, STORAGE: 4, NETWORK: 5, INTERNAL: 6
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
			input.channel = args[0].substr(1,1); //may be a letter, see above
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
			return readInput(args);
		}
	}
}

// One input as the projector names it. The code stays whole — it is what goes
// back onto the wire when this input is chosen.
var readInput = function(code){
	var source = parseInt(code.substr(0,1));
	var channel = code.substr(1,1);
	return {source: source, channel: channel, code: code, name: findSourceName(source, channel)};
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
			inputs.push(readInput(input));
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
 *  From here on: PJLink Class 2.
 *  Every command sets `cls = 2` and therefore goes onto the wire with the
 *  %2 header, no matter which class the connection uses.
 *****************************************************************/

/************* VOLUME (SVOL / MVOL) ************/

Command.VOLUME = { DOWN: 0, UP: 1 };

// For volume, PJLink only knows "one step up" and "one step down". There is
// no current level — that is how the spec defines it, not a shortcoming.
var directionValue = function(value){
	if(value===Command.VOLUME.UP || value===true) return 1;
	if(value===Command.VOLUME.DOWN || value===false) return 0;
	if(typeof value==='string'){
		if(value.toLowerCase()==='up') return 1;
		if(value.toLowerCase()==='down') return 0;
	}
	throw new Error('Direction missing: allowed are up and down');
}

var volumeParts = function(cmd, args){
	var cb;
	args = Array.prototype.slice.call(args, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	return {cmd: cmd, data: directionValue(args.shift()), cb: cb};
}

Command.SVOLCommand = function(){
	var c = volumeParts('SVOL', arguments);
	Command.call(this, c.cmd, c.data, c.cb);
	this.cls = 2;
}

util.inherits(Command.SVOLCommand, Command);

Command.MVOLCommand = function(){
	var c = volumeParts('MVOL', arguments);
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
	// A projector answers a switching command with OK. That is not a state
	// report — it must never turn into "freeze is off".
	if(args.length>0){
		if(args[0]==='1') return true;
		if(args[0]==='0') return false;
	}
}

/************* SERIAL NUMBER ************/

// Answers to these queries may contain spaces. The parser in response.js
// splits on them — here the text is put back together.
var asText = function(args){
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

Command.SerialNumberCommand.prototype.formatResult = asText;

/************* SOFTWARE VERSION ************/

Command.SoftwareVersionCommand = function(){
	var cb;
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	Command.call(this, 'SVER', '?', cb);
	this.cls = 2;
}

util.inherits(Command.SoftwareVersionCommand, Command);

Command.SoftwareVersionCommand.prototype.formatResult = asText;

/************* INPUT NAME ************/

// The only query command with a parameter: %2INNM ?31 asks for the name of
// one specific input. No projector answers a bare "?".
Command.InputNameCommand = function(){
	var cb;
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	var code = args.shift();
	if(typeof code!=='string' || code.length!==2){
		throw new Error('Input missing: a two-digit code such as 31 is expected');
	}

	Command.call(this, 'INNM', '?'+code, cb);
	this.cls = 2;
}

util.inherits(Command.InputNameCommand, Command);

Command.InputNameCommand.prototype.formatResult = asText;

/************* RESOLUTION (IRES / RRES) ************/

// "1920x1080" gets split up. "-" (no signal) and "*" (signal cannot be
// classified) are valid answers and are kept as the code they are — what
// they become in plain words is the application's call, not the protocol's.
var asResolution = function(args){
	if(args.length===0) return null;

	var code = args[0];
	var parts = /^(\d+)x(\d+)$/.exec(code);

	if(!parts) return {code: code, width: null, height: null};

	return {code: code, width: parseInt(parts[1]), height: parseInt(parts[2])};
}

Command.InputResolutionCommand = function(){
	var cb;
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	Command.call(this, 'IRES', '?', cb);
	this.cls = 2;
}

util.inherits(Command.InputResolutionCommand, Command);

Command.InputResolutionCommand.prototype.formatResult = asResolution;

Command.RecommendResolutionCommand = function(){
	var cb;
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	Command.call(this, 'RRES', '?', cb);
	this.cls = 2;
}

util.inherits(Command.RecommendResolutionCommand, Command);

Command.RecommendResolutionCommand.prototype.formatResult = asResolution;

/************* FILTER USAGE ************/

// Careful, unlike LAMP: FILT returns a single value — the accumulated
// operating hours of the filter. No pairs of hours and state to split apart.
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

// Model numbers of the replacement parts, separated by spaces — several
// numbers for several lamps. Devices without a replaceable lamp (laser)
// answer empty; that becomes an empty list, not an error.
var asPartsList = function(args){
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

Command.LampReplacementCommand.prototype.formatResult = asPartsList;

Command.FilterReplacementCommand = function(){
	var cb;
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	Command.call(this, 'RFIL', '?', cb);
	this.cls = 2;
}

util.inherits(Command.FilterReplacementCommand, Command);

Command.FilterReplacementCommand.prototype.formatResult = asPartsList;

/************* CLASS ************/

Command.ClassCommand = function(){
	var cb;
	var data = '?';
	var args = Array.prototype.slice.call(arguments, 0);

	if(typeof args[args.length-1]==='function') cb = args.pop();

	Command.call(this, 'CLSS', data, cb);
}

util.inherits(Command.ClassCommand, Command);

// The spec only foresees the bare digit ("1"/"2") in reply to %1CLSS ?.
// Not every device sticks to that: Optoma answers "Class 1" — measured on a
// real device. Because response.js splits on spaces, such an answer arrives
// in several parts; anything expecting a single digit comes away empty
// handed with these devices.
// So the digit is read out of the answer instead of being assumed. The
// wording is kept so the activity log can show what the device really said.
Command.ClassCommand.prototype.formatResult = function(args){
	var raw = args.join(' ');
	var match = /\d/.exec(raw);
	var cls = match ? parseInt(match[0], 10) : null;

	// PJLink only knows Class 1 and 2. Anything else is not a class.
	if(cls!==1 && cls!==2) cls = null;

	return {cls: cls, raw: raw};
}


/************* RAW ************/

// A line typed into the PJLink console on the technical page. It carries its
// own class, and its answer comes back exactly as the projector wrote it —
// ERR1 to ERR4 included, because those are precisely what someone at the
// console wants to see. Only what is not an answer is an error: a timeout, a
// dropped connection, a refused password.
Command.RawCommand = function(cls, cmd, param, cb){
	Command.call(this, cmd, param, cb);
	this.cls = cls;
}

util.inherits(Command.RawCommand, Command);

Command.RawCommand.prototype.handleResponse = function(resp){
	if(!this.cb) return;

	// Made up on this side (timeout, connection gone): no line to show.
	if(!resp.cmd) return this.cb(resp.getError());

	if(resp.cmd===response.AUTH){
		return this.cb(resp.getError() || response.getError(response.ERRORS.ERRA));
	}

	this.cb(null, resp.raw);
}

module.exports = Command;
