
// Configuration.
var config = require('./config.js');
// E-mailing utility.
var email = require('emailjs/email');

// Global variable containing the application log.
var log = [];
// Global variable indicating whether the log includes warnings.
var warns = false;

// Method that adds a log entry.
function add(type, message) {
  // This switch is mostly used for formatting, but is also used to suppress debug messages and handle warnings (flip the warning flag).
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

// Aggregate all log entries into a single log text seperated with newlines.
function aggregate() {
  var r = "\n";
  for(l in log) {
    r = r + log[l] + "\n";
  }
  return r;
}

// Play the log so far to the console.
function play() {
  console.log(aggregate());
}

// Send the log so far to an e-mail address.
function send() {
  // We can configure the program to e-mail only when there are warnings, or to e-mail always.
  if (config.always || warns) {
    
    // We establish a connection to the mail server.
    var s = email.server.connect({
      user: config.email.user,
      password: config.email.pass,
      host: config.email.server,
      ssl: config.email.ssl
    })
    
    // We assemble the e-mail.
    s.send({
      text: aggregate(), // The log content.
      from: config.email.from, // Our configured sender.
      to: config.email.rcpt, // Our configured recipient.
      subject: 'BGP Monitor (' + (warns ? "Warnings!" : "No Warnings") + ')' // A subject line.
    }, function(err, message) {
      if (err) {
        console.log(err); // We will log an error if the mail could not be send. We could try to alert the administrator of this, but it has to be some other way than via e-mail. ;)
      } else {
        console.log("Email sent.");
      }
    });
    
  } else {
    console.log("No warnings, no email sent.");
  }
}

// Register the module.
module.exports = {
  add: add,
  play: play,
  send: send
};