var config = require('./config.js');

var log = require('./log.js');

var traceroute = (require('net-ping')).createSession();
var rest = new (require('node-rest-client').Client)();
var sleep = require('sleep');

var hopinfo = {};

log("info", "Starting traceroute...");

traceroute.traceRoute(config.host, 30, parseHop, tracerouteDone);

function parseHop(error, target, ttl, send, received) {
  if (error) {
    var ip = error.source;
  } else {
    var ip = target;
  }
  
  if (typeof ip !== "undefined") {
    log("debug", "Hop: " + ip)
    
    hopinfo[ip] = {'ip': ip, 'completed': false, 'as': null, 'holder': null};
    
    // We request AS information from RIPEstat.
    (function(ip) {
      rest.get("https://stat.ripe.net/data/prefix-overview/data.json?resource=" + ip, function(data, response) {
        // RIPE can provide us with an AS
        if (data.data.asns.length > 0) {
          log("debug", "Received RIPE info for " + ip + ".");
          hopinfo[ip].as = data.data.asns[0].asn;
          hopinfo[ip].holder = data.data.asns[0].holder;
          hopinfo[ip].completed = true;
        // RIPE cannot provide us with an AS
        } else {
          log("debug", "No RIPE info available for " + ip + ".");
          hopinfo[ip].completed = true;
        }
        tracerouteDone(null, null);
      });
    })(ip);
  } else {
    log("warn", "Traceroute contains a hidden hop!");
  }
}

function tracerouteDone(error, trgt) {  
  var hops = Object.keys(hopinfo);
  
  // This code block will be called every time. First we need to check if all information gathering is complete.
  for (h in hops) {
    if (hopinfo[hops[h]].completed == false) {
      log("debug", "Waiting for more information...");
      return;
    }
  }

  log("info", "Traceroute finished and data gathered.");
  
  parseTraceroute();
}

function parseTraceroute() {
  log("info", "Analyzing traceroute...");
  
  var aspath = [];
  var aspathinfo = [];
  
  /* 
     We check whether IP addresses are announced (and thus public).
     We allow the traceroute to start internally (using private IP's) but once we reach the public internet, if we cannot resolve an IP to an AS we error.
  */
  var internal = true;
  var hops = Object.keys(hopinfo);
  for (h in hops) {
    if (hopinfo[hops[h]].as == null) {
      if (internal) {
        log("debug", "In internal network...");
      } else {
        log("warn", "We unexpectedly hit an internal IP address...");
      }
    } else {
      if (internal) {
        internal = false;
        log("debug", "We went from an internal network to an outside network...");
      } else {
        log("debug", "Normal hop transition.");
      }
    }
    
    // If IP address is normal, verify if we switched AS and add new AS to path.
    var as = hopinfo[hops[h]].as;
    if (as != null) {
      if (aspath.indexOf(as) == -1) {
        aspath.push(as);
        aspathinfo.push({'as': as, 'holder': hopinfo[hops[h]].holder});
      }
    }
  }
  
  log("info", "Verifying AS path...");
    
  // We now have a complete AS path from monitor to host. Let's compare it with the expected path.
  if (aspath.length != config.path.length) {
    log("warn", "The measured path and configured path are not of the same length! Something is wrong! (Altough it might just be your configured path...)");
  } else {
    for (h in aspath) {
      if (aspath[h] === config.path[h]) {
        log("debug", "Hop "+h+" is good: "+aspath[h]+" ().");
      } else {
        if (h > 0) {
          log("warn", "Hop "+h+" (prev. "+aspath[h-1]+": "+aspathinfo[h-1].holder+") is off: was "+aspath[h]+" ("+aspathinfo[h].holder+") but should be "+config.path[h]+". (Is your configured path right?)");
        } else {
          log("warn", "Hop "+h+" is off: was "+aspath[h]+" ("+aspathinfo[h].holder+") but should be "+config.path[h]+". (Is your configured path right?)");
        }
      }
    }
  }
  
  log("info", "Traceroute execution and verification is complete. Any warnings have been shown.");
}