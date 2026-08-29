var Response = function(cmd, err, args){
	this.cmd = cmd;
	this.err = err;
	this.args = args;

	if(args && typeof this.args!=='object'){
		this.args = [this.args];
	}
}

Response.AUTH = 'PJLINK';

Response.ERRORS = {
	'OK': null,
	'ERR1': 'Undefined command',
	'ERR2': 'Out of parameter',
	'ERR3': 'Unavailable time',
	'ERR4': 'Projector/Display failure',
	'ERRA': 'Authorization failed',
	'ERRM': 'Command reply mismatch',
	'ERRD': 'Not connected'
}

Response.prototype.isError = function(){
	return this.err!==null && typeof this.err!=='undefined';
}

Response.prototype.getError = function(){
	if(!this.isError()) return null;

	if(typeof this.err == 'object') return this.err;

	return Response.getError(this.err);
}

Response.getError = function(err){
	if(!err) return null;
	return new Error(err);
}

Response.prototype.hasArgs = function(){
	return this.args && this.args.length>0;
}

Response.prototype.getArgs = function(){
	return this.args;
}

// What a projector sends that is not a response to anything. The command that
// was waiting is told so — the alternative is that it waits out its full
// timeout for an answer that has already arrived and been thrown away.
Response.MALFORMED = 'Malformed response';

Response.parse = function(data){
	if(typeof data==='object' && data.toString) data = data.toString();

	data = data.trim();//cut off trailing CR

	var cmd, args, err;

	var cmd = data.substr(0,6).toUpperCase();//header + command;

	// Spec 2.2: header, class, four characters of command body, then '='. The
	// separator is not decoration — without it the line is not an answer, and
	// reading it as one invents a value the projector never gave. The greeting
	// is the one line that carries a space instead and is still in order.
	if(cmd!==Response.AUTH && data.charAt(6)!=='='){
		return new Response(cmd, Response.MALFORMED);
	}

	data = data.substr(7);//skip to the data

	//the data should now contain an error if it is there
	if(Response.ERRORS.hasOwnProperty(data)){
		err = Response.ERRORS[data];
		data = null;
	}

	//handle authentication
	var level;
	if(cmd==Response.AUTH){
		//more general error checking here
		if(!err){
			// The digit says what the projector wants: 0 no password, 1 the
			// procedure of the old specification, 2 the SHA256 one of version
			// 2.10. Without it "PJLINK 1 <random>" and "PJLINK 2 <random>"
			// look the same, and they mean entirely different things.
			level = parseInt(data.substr(0,1));
			data = data.substr(2);//we read over the digit and the space
		}
	}else{
		cmd = cmd.substr(2);//read the space character
	}

	if(data && data.length){
		args = data.split(' ');
	}

	var response = new Response(cmd,err,args);
	response.level = level;
	return response;
}

Response.prototype.cmd = null;
Response.prototype.args = null;
Response.prototype.cls = 1;
// Only greetings carry one — see the parser.
Response.prototype.level = undefined;

module.exports = Response;
