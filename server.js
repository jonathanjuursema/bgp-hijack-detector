var process = require('process');

var config = require('./config.js');
var log = require('./log.js');

if (process.getuid() != 0) {
  log("error", "You need to be root to run this program so we can send ICMP pings for better traceroute results.");
  process.exit(1);
}

var traceroute = (require('net-ping')).createSession();
var rest = new (require('node-rest-client').Client)();
var sleep = require('sleep');

var hopinfo = {};
var traceroutedone = false;

log("info", "Starting traceroute...");

// We perform two checks. One looks up the current announcements for a given set of IP-addresses, the other performs a traceroute to a specific hosts and verifies the path.
traceroute.traceRoute(config.host, {ttl: 30, maxHopTimeouts: 10}, parseHop, tracerouteDone);

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
          hopinfo[ip].as = -1;
          hopinfo[ip].holder = "!!! Unannounced IP(s) !!!";
          hopinfo[ip].completed = true;
        }
        parseTraceroute();
      });
    })(ip);
  } else {
    log("warn", "Traceroute cannot ping hop!");
    ip = "0.0.0." + Object.keys(hopinfo).length;
    hopinfo[ip] = {'ip': ip, 'completed': true, 'as': -2, 'holder': "!!! Unpingable Hop(s) !!!"};
  }
}

function tracerouteDone(error, trgt) {  
  
  traceroutedone = true;
  parseTraceroute();
  
}

function parseTraceroute() {
  
  var hops = Object.keys(hopinfo);
  
  // This code block will be called every time. First we need to check if all information gathering is complete.
  for (h in hops) {
    if (hopinfo[hops[h]].completed == false || !traceroutedone) {
      log("debug", "Waiting for more information...");
      return;
    }
  }
  
  log("info", "Traceroute finished and data gathered.");
  
  log("info", "Analyzing traceroute...");
  
  var aspath = [];
  var aspathinfo = [];
  
  /* 
     We check whether IP addresses are announced (and thus public).
  */
  var internal = true;
  var hops = Object.keys(hopinfo);
  for (h in hops) {    
    // If IP address is normal, verify if we switched AS and add new AS to path.
    var as = hopinfo[hops[h]].as;
    if (as != null) {
      if (aspath[aspath.length - 1] != as) {
        aspath.push(as);
        aspathinfo.push({'as': as, 'holder': hopinfo[hops[h]].holder, 'hops': 1});
      } else {
        aspathinfo[aspathinfo.length-1].hops += 1;
      }
    }
  }
  
  log("info", "Verifying AS path...");
    
  // We now have a complete AS path from monitor to host. Let's compare it with the expected path.
  for (h in aspathinfo) {
    if (h < config.path.length) {
      if (aspath[h] === config.path[h]) {
        log("info", "AS Hop "+h+" is good: "+aspath[h]+" ("+aspathinfo[h].holder+"). Hops in AS: " + aspathinfo[h].hops);
      } else {
        log("warn", "AS Hop "+h+" is off: was "+aspath[h]+" ("+aspathinfo[h].holder+") but should be "+config.path[h]+" ("+config.pathname[h]+"). (Is your configured path right?) Hops in AS: " + aspathinfo[h].hops);
      }
    } else {
      log("warn", "AS Hop "+h+" is unexpected, path longer than expected: "+aspath[h]+" ("+aspathinfo[h].holder+"). Hops in AS: " + aspathinfo[h].hops);
    }
  }
  
  log("info", "Traceroute execution and verification is complete. Total hop count: " + Object.keys(hopinfo).length + ". Any warnings have been shown.");
}