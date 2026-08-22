var util	= require('util'),
	net		= require('net'),
	crypto	= require('crypto'),
	pjcommand	= require('./command'),
	pjresponse	= require('./response');

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
		"timeout": 0
	};

	this.class = 1;

	this._connection = null;
	this._digest = null;
	this._cmdQueue = [];
	this._cmdWaiting = false;

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

// Setzt die Stummschaltung mit einem rohen PJLink-AVMT-Wert.
// 11/10 = Video stumm ein/aus, 21/20 = Ton stumm ein/aus.
// Nötig, weil MuteCommand Video und Ton nicht unabhängig abschalten kann:
// dort gibt es nur "beide aus" (30), womit sich Video nicht allein entstummen lässt.
PJLink.prototype.setMuteRaw = function(code, cb){
	this._addCommand(new pjcommand('AVMT', code, cb));
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
 *  Ab hier: PJLink Class 2.
 *  Diese Befehle gehen mit dem Header %2 auf dieselbe Verbindung
 *  wie die Class-1-Befehle darüber. Ein Beamer, der nur Class 1
 *  beherrscht, antwortet darauf mit ERR1 — das kommt als normaler
 *  Fehler beim Aufrufer an und lässt die Verbindung unberührt.
 *****************************************************************/

/************************/
/*	VOLUME (SVOL/MVOL) 	*/
/************************/
PJLink.VOLUME = pjcommand.VOLUME;

// PJLink kennt bei der Lautstärke nur "eine Stufe hoch" und "eine Stufe
// runter". Einen Ist-Wert gibt es nicht und er lässt sich auch nicht
// abfragen — so steht es in der Spezifikation.
PJLink.prototype.setSpeakerVolume = function(richtung, cb){
	this._addCommand(new pjcommand.SVOLCommand(richtung, cb));
}

PJLink.prototype.speakerVolumeUp = function(cb){
	this.setSpeakerVolume(PJLink.VOLUME.UP, cb);
}

PJLink.prototype.speakerVolumeDown = function(cb){
	this.setSpeakerVolume(PJLink.VOLUME.DOWN, cb);
}

PJLink.prototype.setMicrophoneVolume = function(richtung, cb){
	this._addCommand(new pjcommand.MVOLCommand(richtung, cb));
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
PJLink.prototype.setFreeze = function(an, cb){
	this._addCommand(new pjcommand.FreezeCommand(an, cb));
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
	this._cmdWaiting = false;
}

PJLink.prototype._onData = function(buffer){
	var response = pjresponse.parse(buffer);

	if(!response) return; //what went wrong?

	//it is a non-error auth command
	if(response.cmd==pjresponse.AUTH && !response.isError()){
		if(response.hasArgs()){
			this._calcDigest(response.args[0]);
		}
	}else{
		//process the first command in the queue
		this._handleResponse(response);
	}

	//do the next one on next occasion
	process.nextTick(this._sendCommand.bind(this));

}

PJLink.prototype._onError = function(err){
	this._handleResponse(new pjresponse(null, err.message));
}

PJLink.prototype._onClose = function(had_error){
	this._resetConnection();
}

PJLink.prototype._resetConnection = function(){
	if(this._cmdWaiting){
		this._handleResponse(new pjresponse(null, pjresponse.getError(pjresponse.ERRORS.ERRD)));
	}

	if(this._connection){
		this._connection.removeListener('data', this._dataCB);
		this._connection.removeListener('error', this._errorCB);
		this._connection.removeListener('close', this._closeCB);
		this._connection.removeListener('timeout', this._timeoutCB);
		this._connection.end();
	}

	//reset the connection etc
	this._connection = null;
	this._digest = null;
	process.nextTick(this._sendCommand.bind(this));
}

PJLink.prototype._onTimeout = function(){
	var error = new Error('Connection timeout');
    while(this._cmdQueue.length){
            this._onError(error);
    }
	this._onClose();
}

PJLink.prototype._calcDigest = function(rand){
	var md5 = crypto.createHash('md5');
	md5.setEncoding('hex');
	md5.write(rand);
	md5.end(this.settings.password);
	this._digest = md5.read();
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

	this._cmdWaiting = true;

	// Die Klasse steht am Befehl, nicht an der Verbindung: Class-1- und
	// Class-2-Befehle teilen sich eine Verbindung und diese Warteschlange.
	// Befehle ohne eigene Klasse bekommen die der Verbindung.
	var msg = this._cmdQueue[0].toWire(this.class);

	if(this._digest){
		msg = this._digest + msg;
		this._digest = null; //always reset after first send
	}

	this._connection.write(msg + "\r", function(){});
}

PJLink.prototype._handleResponse = function(response){
	if(!response || this._cmdQueue.length==0) return;

	var cmd = this._cmdQueue.shift();
	if(cmd) cmd.handleResponse(response);

	this._cmdWaiting = false;
}

module.exports = PJLink;
