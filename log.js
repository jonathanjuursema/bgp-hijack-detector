var config = require('./config.js');

function log(type, message) {
  switch(type) {
    case 'debug':
      if (config.debug == true) {
        console.log("[ debug ] " + message);
      }
      break;
    case 'info':
      console.log("[ info  ] " + message);
      break;
    case 'error':
      console.log("[ error ] " + message);
      break;
    case 'warn':
      console.log("[ warn  ] " + message);
      break;
  }
}

module.exports = log;