var config = require('./config.js');
var email = require('emailjs/email');

var log = [];
var warns = false;

function add(type, message) {
  switch(type) {
    case 'debug':
      if (config.debug == true) {
        log.push("[ debug ] " + message);
      }
      break;
    case 'info':
      log.push("[ info  ] " + message);
      break;
    case 'error':
      warns = true;
      log.push("[ error ] " + message);
      break;
    case 'warn':
      warns = true;
      log.push("[ warn  ] " + message);
      break;
  }
}

function aggregate() {
  var r = "\n";
  for(l in log) {
    r = r + log[l] + "\n";
  }
  return r;
}

function play() {
  console.log(aggregate());
}

function send() {
  if (config.always || warns) {
    
    var s = email.server.connect({
      user: config.email.user,
      password: config.email.pass,
      host: config.email.server,
      ssl: config.email.ssl
    })
    
    s.send({
      text: aggregate(),
      from: config.email.from,
      to: config.email.rcpt,
      subject: 'BGP Monitor (' + (warns ? "Warnings!" : "No Warnings") + ')'
    }, function(err, message) {
      if (err) {
        console.log(err);
      } else {
        console.log("Email sent.");
      }
    });
    
  } else {
    console.log("No warnings, no email sent.");
  }
}

module.exports = {
  add: add,
  play: play,
  send: send
};