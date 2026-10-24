var util	= require('util'),
	net		= require('net'),
	crypto	= require('crypto'),
	pjcommand	= require('./command'),
	pjresponse	= require('./response');

// A record of what really goes over the wire, switched on with PJLINK_TRACE=1.
// It is the only way to tell three things apart that all end up as the same
// error message: the projector said no, the projector said nothing at all, and
// the projector was never asked because the connection had already gone.
// Off by default — in normal operation nobody wants this, and it would write a
// line for every beat of the poll loop.
var trace = process.env.PJLINK_TRACE
	? function(what, detail){
		var t = new Date().toISOString().substr(11, 12);
		console.error('[pjlink ' + t + '] ' + what + (detail===undefined ? '' : ' ' + JSON.stringify(detail)));
	}
	: function(){};

var PJLink = function(host, port, password){

	var settings = {};
	if(typeof host==="object"){
		settings = host;
	}else{
		if(host) settings.host = host;
		if(port) settings.port = port;
		if(password) settings.password = password;
	}

	this.settings = {
		"host": "192.168.1.1",
		"port": 4352,
		"password": null,
		"timeout": 0,
		// How long the question about the security level may go unanswered.
		// The spec allows a projector two seconds for any answer (6, Response
		// method); one that says nothing in that time is one that has never
		// heard of the question.
		"authTimeout": 2000
	};

	this.class = 1;

	this._connection = null;
	this._digest = null;
	this._cmdQueue = [];
	this._cmdWaiting = false;
	// What has come in but has not ended in a CR yet — see _onData.
	this._incoming = '';
	// Has the projector greeted us on this connection? Until it has, nothing
	// may go out: a command sent before the greeting carries no authentication
	// data, and the projector answers it with ERRA or with nothing at all.
	this._greeted = false;
	// Which authentication procedure this projector knows: 2 = the SHA256 one
	// of version 2.10, 1 = the one of the old specification. null means it has
	// not been asked yet. A property of the device, so it is asked once.
	this._securityLevel = null;
	this._authTimer = null;
	// Running while a command with an answer timeout of its own waits.
	this._answerTimer = null;

	var mergedSettings = {};
	for (var attrname in this.settings) { mergedSettings[attrname] = this.settings[attrname]; }
	for (var attrname in settings) { mergedSettings[attrname] = settings[attrname]; }

	this.settings = mergedSettings;
};

PJLink.prototype.disconnect = function(){
	this._resetConnection();
}

/************/
/*	POWER 	*/
/************/
PJLink.POWER = pjcommand.POWER;

PJLink.prototype.powerOn = function(cb){
	this.setPowerState(PJLink.POWER.ON, cb);
}

PJLink.prototype.powerOff = function(cb){
	this.setPowerState(PJLink.POWER.OFF, cb);
}

PJLink.prototype.setPowerState = function(state, cb){
	this._addCommand(new pjcommand.PowerCommand(state, cb));
}

PJLink.prototype.getPowerState = function(cb){
	this._addCommand(new pjcommand.PowerCommand(cb));
}

/************/
/*	INPUT 	*/
/************/
PJLink.INPUT = pjcommand.INPUT;

PJLink.prototype.setInput = function(){
	var args = Array.prototype.slice.call(arguments, 0);
	args.unshift(null);
	this._addCommand(
		new (pjcommand.InputCommand.bind.apply(pjcommand.InputCommand, args))()
	);
}

PJLink.prototype.getInput = function(cb){
	this._addCommand(new pjcommand.InputCommand(cb));
}

/************/
/*	MUTE 	*/
/************/
PJLink.prototype.setMute = function(val, cb){
	this._addCommand(
		new pjcommand.MuteCommand(val, cb)
	);
}

PJLink.prototype.getMute = function(cb){
	this._addCommand(
		new pjcommand.MuteCommand(cb)
	);
}

// Sets the mute state with a raw PJLink AVMT value.
// 11/10 = video mute on/off, 21/20 = audio mute on/off.
// Needed because MuteCommand cannot switch video and audio independently:
// it only offers "both off" (30), which cannot unmute video on its own.
//
// options.answerTimeout: how long to wait for the answer, in ms, for a device
// that is known to carry the command out without answering. Without it the
// command waits out the connection's full timeout — and holds up every query
// queued behind it for that long.
PJLink.prototype.setMuteRaw = function(code, options, cb){
	if(typeof options==='function'){
		cb = options;
		options = null;
	}
	var command = new pjcommand('AVMT', code, cb);
	if(options && options.answerTimeout) command.answerTimeout = options.answerTimeout;
	this._addCommand(command);
}

// Sends a line from the PJLink console, as {cls, cmd, param} from
// lib/pjlink-reference.js parseLine(). The answer comes back as the raw line.
PJLink.prototype.sendRaw = function(parts, cb){
	this._addCommand(new pjcommand.RawCommand(parts.cls, parts.cmd, parts.param, cb));
}

/************/
/*	ERROR 	*/
/************/
PJLink.prototype.getErrors = function(cb){
	this._addCommand(
		new pjcommand.ErrorsCommand(cb)
	);
}

/************/
/*	LAMP 	*/
/************/
PJLink.prototype.getLamps = function(cb){
	this._addCommand(
		new pjcommand.LampCommand(cb)
	);
}

/************/
/*	LAMP 	*/
/************/
PJLink.prototype.getInputs = function(cb){
	this._addCommand(
		new pjcommand.InputsCommand(cb)
	);
}

/************/
/*	NAME 	*/
/************/
PJLink.prototype.getName = function(cb){
	this._addCommand(
		new pjcommand.NameCommand(cb)
	);
}

/************/
/*	MANUFACTURER 	*/
/************/
PJLink.prototype.getManufacturer = function(cb){
	this._addCommand(
		new pjcommand.ManufacturerCommand(cb)
	);
}

/************/
/*	MODEL 	*/
/************/
PJLink.prototype.getModel = function(cb){
	this._addCommand(
		new pjcommand.ModelCommand(cb)
	);
}

/************/
/*	INFO 	*/
/************/
PJLink.prototype.getInfo = function(cb){
	this._addCommand(
		new pjcommand.InfoCommand(cb)
	);
}

/************/
/*	CLASS 	*/
/************/
PJLink.prototype.getClass = function(cb){
	this._addCommand(
		new pjcommand.ClassCommand(cb)
	);
}


/*****************************************************************
 *  From here on: PJLink Class 2.
 *  These commands go onto the same connection as the Class 1 commands
 *  above, but with the %2 header. A projector that only supports Class 1
 *  answers them with ERR1 — that reaches the caller as an ordinary error
 *  and leaves the connection untouched.
 *****************************************************************/

/************************/
/*	VOLUME (SVOL/MVOL) 	*/
/************************/
PJLink.VOLUME = pjcommand.VOLUME;

// For volume, PJLink only knows "one step up" and "one step down". There is
// no current level, and no way to query one — that is what the spec says.
PJLink.prototype.setSpeakerVolume = function(direction, cb){
	this._addCommand(new pjcommand.SVOLCommand(direction, cb));
}

PJLink.prototype.speakerVolumeUp = function(cb){
	this.setSpeakerVolume(PJLink.VOLUME.UP, cb);
}

PJLink.prototype.speakerVolumeDown = function(cb){
	this.setSpeakerVolume(PJLink.VOLUME.DOWN, cb);
}

PJLink.prototype.setMicrophoneVolume = function(direction, cb){
	this._addCommand(new pjcommand.MVOLCommand(direction, cb));
}

PJLink.prototype.microphoneVolumeUp = function(cb){
	this.setMicrophoneVolume(PJLink.VOLUME.UP, cb);
}

PJLink.prototype.microphoneVolumeDown = function(cb){
	this.setMicrophoneVolume(PJLink.VOLUME.DOWN, cb);
}

/************/
/*	FREEZE 	*/
/************/
PJLink.prototype.setFreeze = function(on, cb){
	this._addCommand(new pjcommand.FreezeCommand(on, cb));
}

PJLink.prototype.getFreeze = function(cb){
	this._addCommand(new pjcommand.FreezeCommand(cb));
}

/************************/
/*	SERIAL / VERSION 	*/
/************************/
PJLink.prototype.getSerialNumber = function(cb){
	this._addCommand(new pjcommand.SerialNumberCommand(cb));
}

PJLink.prototype.getSoftwareVersion = function(cb){
	this._addCommand(new pjcommand.SoftwareVersionCommand(cb));
}

/****************/
/*	INPUT NAME 	*/
/****************/
PJLink.prototype.getInputName = function(code, cb){
	this._addCommand(new pjcommand.InputNameCommand(code, cb));
}

/****************/
/*	RESOLUTION 	*/
/****************/
PJLink.prototype.getInputResolution = function(cb){
	this._addCommand(new pjcommand.InputResolutionCommand(cb));
}

PJLink.prototype.getRecommendedResolution = function(cb){
	this._addCommand(new pjcommand.RecommendResolutionCommand(cb));
}

/****************/
/*	MAINTENANCE */
/****************/
PJLink.prototype.getFilterUsage = function(cb){
	this._addCommand(new pjcommand.FilterUsageCommand(cb));
}

PJLink.prototype.getLampReplacements = function(cb){
	this._addCommand(new pjcommand.LampReplacementCommand(cb));
}

PJLink.prototype.getFilterReplacements = function(cb){
	this._addCommand(new pjcommand.FilterReplacementCommand(cb));
}



//** PRIVATE FUNCTIONS **/
PJLink.prototype._connect = function(){
	trace('connecting to', this.settings.host + ':' + this.settings.port);
	this._cmdWaiting = true;
	this._connection = net.connect({port: this.settings.port, host: this.settings.host}, this._onConnect.bind(this));

	//callbacks
	this._dataCB = this._onData.bind(this);
	this._errorCB = this._onError.bind(this);
	this._closeCB = this._onClose.bind(this);
	this._timeoutCB = this._onTimeout.bind(this);

	this._connection.on('data', this._dataCB);
	this._connection.on('error', this._errorCB);
	this._connection.on('close', this._closeCB);
	this._connection.on('timeout', this._timeoutCB);
	this._connection.setTimeout(this.settings.timeout);
	this._connection.setNoDelay(true);

}

PJLink.prototype._onConnect = function(){
	trace('connected, waiting for the greeting');
	this._cmdWaiting = false;
}

// TCP knows no lines, only bytes. What the projector writes in one go can
// arrive in two pieces, and what it writes in two can arrive as one. The spec
// (2.2) names the carriage return as the terminator of a response — that, and
// nothing else, marks where one ends.
//
// Taking each arrival for a whole response gets this wrong twice over: half a
// response is read as a complete one (a power state that is neither on nor
// off, a mute state that is neither), and the other half then turns up with
// nothing waiting for it.
PJLink.prototype._onData = function(buffer){
	trace('<- received', buffer.toString());

	this._incoming += buffer.toString();

	var i;
	while((i = this._incoming.indexOf('\r')) !== -1){
		var line = this._incoming.slice(0, i);
		this._incoming = this._incoming.slice(i+1);
		if(line.length) this._handleLine(line);
	}
}

PJLink.prototype._handleLine = function(line){
	var response = pjresponse.parse(line);

	if(!response) return; //what went wrong?

	//it is an auth command
	if(response.cmd==pjresponse.AUTH){
		// A refusal while we are asking about the security level is not a
		// wrong password — it is a projector that does not know the question.
		if(response.isError() && this._authTimer){
			return this._fallBackToOldSecurity();
		}

		if(!response.isError()){
			this._handleGreeting(response);
			return;
		}
	}

	//process the first command in the queue
	this._handleResponse(response);

	// Spec 5.4: the controller closes the connection as soon as the exchange
	// it needed is done. Holding it open saves a handshake and costs the one
	// thing that matters here — certainty: the projector gives an idle
	// connection 30 seconds, real devices often less, and a connection it has
	// thrown away swallows the next command without a word. A connection that
	// has just been opened cannot be stale.
	//
	// _resetConnection sends the next command on its own once the socket is
	// gone, so the queue keeps moving.
	this._resetConnection();
}

PJLink.prototype._onError = function(err){
	trace('!! error', err.message);
	this._handleResponse(new pjresponse(null, err.message));
}

PJLink.prototype._onClose = function(had_error){
	trace('connection closed', {byError: !!had_error, stillQueued: this._cmdQueue.length});
	this._resetConnection();
}

PJLink.prototype._resetConnection = function(){
	if(this._cmdWaiting){
		this._handleResponse(new pjresponse(null, pjresponse.getError(pjresponse.ERRORS.ERRD)));
	}

	// Whatever we were waiting for is over. Without this line an object whose
	// queue happened to be empty here would stay "waiting" for good and never
	// send another command.
	this._cmdWaiting = false;

	if(this._connection){
		var socket = this._connection;

		socket.removeListener('data', this._dataCB);
		socket.removeListener('error', this._errorCB);
		socket.removeListener('close', this._closeCB);
		socket.removeListener('timeout', this._timeoutCB);

		// A socket without an 'error' listener turns its next error into an
		// uncaught exception — in Electron that is a dialog box in the user's
		// face. And there is always a next error to come: the projector resets
		// the connection, or the operating system gives up on an unreachable
		// host a minute later. We are no longer interested in either.
		socket.on('error', function(){});

		// end() only asks politely and leaves an unfinished connection attempt
		// running. destroy() actually lets go.
		socket.destroy();
	}

	//reset the connection etc
	this._connection = null;
	this._digest = null;
	// Half a response from a connection that is gone belongs to nobody. It
	// must not be glued to the first thing the next connection says.
	this._incoming = '';
	// Authentication is a matter of the connection: spec 5.1 has it run once
	// after each one is established. The next one greets us again.
	this._greeted = false;
	this._clearAuthTimer();
	process.nextTick(this._sendCommand.bind(this));
}

PJLink.prototype._onTimeout = function(){
	trace('!! nothing heard for ' + this.settings.timeout + ' ms', {waitingFor: this._cmdQueue.map(function(c){ return c.toString(); })});
	var error = new Error('Connection timeout');
    while(this._cmdQueue.length){
            this._onError(error);
    }
	this._onClose();
}

/************************/
/*	AUTHENTICATION 		*/
/************************/
//
// The projector greets every new connection and says in one digit what it
// wants (spec 5.1, 5.2):
//
//   PJLINK 0             no password, go ahead
//   PJLINK 1 <8 hex>     a password, by the procedure of the old spec: the
//                        MD5 of random number + password goes in front of the
//                        first command
//   PJLINK 2 <32 hex>    the answer to our question, and the promise that it
//                        can do the procedure of version 2.10: our own random
//                        number and a SHA256 hash go in front of the command
//
// Which of the two a device knows is not something it announces — it has to be
// asked, with a bare "PJLINK 2". A device that does not know the question
// answers with an error, with something else, or not at all; all three mean
// the same, and the spec has the session end and start again with the old
// procedure. That costs one round trip per device, not per command: what came
// out of it is remembered.
PJLink.prototype._handleGreeting = function(response){
	var random = response.hasArgs() ? response.args[0] : null;

	// The answer to our question. From here on it is SHA256.
	if(response.level===2){
		this._clearAuthTimer();

		if(!/^[0-9a-f]{32}$/i.test(random || '')){
			// Announced as the newer procedure, but without a usable random
			// number there is nothing to hash. "Incorrect response" in the
			// wording of 5.1 — the old procedure it is.
			return this._fallBackToOldSecurity();
		}

		this._securityLevel = 2;
		this._digest = this._sha256Digest(random);
		return this._proceed();
	}

	// No password at all, or nothing to authenticate with. Without a password
	// asking about the security level would only cost a round trip on every
	// connection and change nothing about the outcome.
	if(!random || !this.settings.password){
		return this._proceed();
	}

	if(this._securityLevel!==1){
		return this._askSecurityLevel();
	}

	this._digest = this._md5Digest(random);
	this._proceed();
}

// The greeting is done: from here the command may go out.
PJLink.prototype._proceed = function(){
	this._greeted = true;
	process.nextTick(this._sendCommand.bind(this));
}

PJLink.prototype._askSecurityLevel = function(){
	trace('-> sending', 'PJLINK 2');
	this._connection.write('PJLINK 2\r', function(){});

	var self = this;
	this._authTimer = setTimeout(function(){
		trace('.. no answer about the security level');
		self._fallBackToOldSecurity();
	}, this.settings.authTimeout);
}

// Spec 5.1: an error, an unexpected answer, no answer, a dropped session — all
// of them mean this projector does not know the newer procedure. The session
// is ended and built again with the old one. The command that is waiting has
// not been sent yet, so it simply goes out on the next connection.
PJLink.prototype._fallBackToOldSecurity = function(){
	this._clearAuthTimer();
	this._securityLevel = 1;
	trace('.. falling back to the password procedure of the old specification');
	this._resetConnection();
}

PJLink.prototype._clearAuthTimer = function(){
	if(this._authTimer){
		clearTimeout(this._authTimer);
		this._authTimer = null;
	}
}

// Spec 5.1 (1-3) of the old specification: MD5 over the projector's random
// number followed by the password.
PJLink.prototype._md5Digest = function(random){
	var md5 = crypto.createHash('md5');
	md5.setEncoding('hex');
	md5.write(random);
	md5.end(this.settings.password);
	return md5.read();
}

// Spec 5.1 (1-4) and (1-5) of version 2.10: both sides contribute 16 bytes of
// randomness, the two are XORed, and SHA256 runs over that value written out
// as hex, followed by the password. What goes in front of the command is our
// own random number and the hash — the projector needs the former to arrive at
// the same result.
PJLink.prototype._sha256Digest = function(projectorRandom){
	var theirs = Buffer.from(projectorRandom, 'hex');
	var ours = crypto.randomBytes(16);
	var mixed = Buffer.alloc(16);

	for(var i=0; i<16; i++){
		mixed[i] = ours[i] ^ theirs[i];
	}

	var hash = crypto.createHash('sha256')
		.update(mixed.toString('hex') + this.settings.password)
		.digest('hex');

	return ours.toString('hex') + hash;
}

PJLink.prototype._addCommand = function(cmd){
	this._cmdQueue.push(cmd);

	if(!this._cmdWaiting){
		this._sendCommand();
	}
}

PJLink.prototype._sendCommand = function(){
	if(this._cmdQueue.length==0) return;
	if(!this._connection) return this._connect();
	if(this._cmdWaiting) return;

	// Spec 5.1: "Without passing through the authentication procedure, the
	// projector will not accept PJLINK commands." Between the connection being
	// established and the greeting arriving there is a window of up to two
	// seconds; a command that slips out in it carries no authentication data
	// and is answered with ERRA, or with nothing at all. The greeting sends it
	// on its way itself.
	if(!this._greeted) return;

	this._cmdWaiting = true;

	// The class belongs to the command, not to the connection: Class 1 and
	// Class 2 commands share one connection and this queue. Commands
	// without a class of their own get the connection's.
	var msg = this._cmdQueue[0].toWire(this.class);

	if(this._digest){
		msg = this._digest + msg;
		this._digest = null; //always reset after first send
	}

	trace('-> sending', msg);
	this._connection.write(msg + "\r", function(){});

	var command = this._cmdQueue[0];
	if(command.answerTimeout){
		var self = this;
		this._answerTimer = setTimeout(function(){
			self._answerTimer = null;
			if(self._cmdQueue[0]!==command) return;
			trace('.. no answer within ' + command.answerTimeout + ' ms, as expected for', command.toString());
			self._handleResponse(new pjresponse(null, 'Connection timeout'));
			// The connection may still carry the answer that never came — it
			// must not be read as the answer to the next command.
			self._resetConnection();
		}, command.answerTimeout);
	}
}

PJLink.prototype._handleResponse = function(response){
	if(!response || this._cmdQueue.length==0){
		trace('.. answer with nothing waiting for it');
		return;
	}

	if(this._answerTimer){
		clearTimeout(this._answerTimer);
		this._answerTimer = null;
	}

	var cmd = this._cmdQueue.shift();
	trace('.. answer belongs to', cmd.toString());
	if(cmd) cmd.handleResponse(response);

	this._cmdWaiting = false;
}

module.exports = PJLink;
