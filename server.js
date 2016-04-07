var process = require('process');

var config = require('./config.js');
var log = require('./log.js');

if (process.getuid() != 0) {
  log.add("error", "You need to be root to run this program so we can send ICMP pings for better traceroute results.");
  process.exit(1);
}

var traceroute = (require('net-ping')).createSession();
var rest = new (require('node-rest-client').Client)();
var sleep = require('sleep');

var hopinfo = {};
var traceroutedone = false;

// We start by performing a traceroute to a specific host and verifying the path.
log.add("info", "Starting traceroute...");
traceroute.traceRoute(config.host, {ttl: 30, maxHopTimeouts: 10}, parseHop, tracerouteDone);

function parseHop(error, target, ttl, send, received) {
  if (error) {
    var ip = error.source;
  } else {
    var ip = target;
  }
  
  if (typeof ip !== "undefined") {
    log.add("debug", "Hop: " + ip)
    
    hopinfo[ip] = {'ip': ip, 'completed': false, 'as': null, 'holder': null};
    
    // We request AS information from RIPEstat.
    (function(ip) {
      rest.get("https://stat.ripe.net/data/prefix-overview/data.json?resource=" + ip, function(data, response) {
        // RIPE can provide us with an AS
        if (data.data.asns.length > 0) {
          log.add("debug", "Received RIPE announcement info for " + ip + ".");
          hopinfo[ip].as = data.data.asns[0].asn;
          hopinfo[ip].holder = data.data.asns[0].holder;
          hopinfo[ip].completed = true;
        // RIPE cannot provide us with an AS
        } else {
          log.add("debug", "RIPE tells us " + ip + " is not announced.");
          hopinfo[ip].as = -1;
          hopinfo[ip].holder = "!!! " + ip + " (Unannounced IP) !!!";
          hopinfo[ip].completed = true;
        }
        parseTraceroute();
      });
    })(ip);
  } else {
    log.add("warn", "Traceroute cannot ping hop!");
    ip = "0.0.0." + Object.keys(hopinfo).length;
    hopinfo[ip] = {'ip': ip, 'completed': true, 'as': -2, 'holder': "!!! Unpingable Hop(s) !!!"};
  }
}

function tracerouteDone(error, trgt) {  
  
  traceroutedone = true;
  parseTraceroute();
  
}

// We will now try to parse the traceroute.
function parseTraceroute() {
  
  var hops = Object.keys(hopinfo);
  
  // This code block will be called every time. First we need to check if all information gathering is complete.
  for (h in hops) {
    if (hopinfo[hops[h]].completed == false || !traceroutedone) {
      log.add("debug", "Waiting for more information...");
      return;
    }
  }
  
  log.add("debug", "Traceroute finished and data gathered, analyzing traceroute");
  
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
  
  log.add("debug", "Verifying AS path...");
    
  // We now have a complete AS path from monitor to host. Let's compare it with the expected path.
  for (h in aspathinfo) {
    if (h < config.path.length) {
      if (aspath[h] === config.path[h]) {
        log.add("info", "AS Hop "+h+" is good: "+aspath[h]+" ("+aspathinfo[h].holder+"). Hops in AS: " + aspathinfo[h].hops);
      } else {
        log.add("warn", "AS Hop "+h+" is off: was "+aspath[h]+" ("+aspathinfo[h].holder+") but should be "+config.path[h]+" ("+config.pathname[h]+"). (Is your configured path right?) Hops in AS: " + aspathinfo[h].hops);
      }
    } else {
      log.add("warn", "AS Hop "+h+" is unexpected, path longer than expected: "+aspath[h]+" ("+aspathinfo[h].holder+"). Hops in AS: " + aspathinfo[h].hops);
    }
  }
  if (aspathinfo.length != config.path.length) {
    log.add("warn", "Path lengths are not the same! Encountered " + aspathinfo.length + " AS hops, but expected " + config.path.length + ".")
  }
  
  log.add("info", "Traceroute execution and verification is complete. Total hop count: " + Object.keys(hopinfo).length + ". Any warnings have been shown.\n");
  
  // We will now test general prefix announcement.
  testPrefixes();
  
}

var prefixesTested = 0;

function testPrefixes() {
  
  log.add("info", "We will now test prefix announcements.");
  
  for(p in config.prefixes) {
    var prefix = config.prefixes[p];
    
    (function(prefix) {
      rest.get("https://stat.ripe.net/data/routing-status/data.json?resource=" + prefix, function(data, response) {
        prefixesTested++;
        
        // IP is announced.
        if (data.data.origins.length > 0) {
          
          log.add("debug", "Received RIPE info for " + prefix + ".");
          for(a in data.data.origins) {
            var as = data.data.origins[a].origin;
            if (config.trusted.indexOf(as) > 0) {
              log.add("info", prefix + " is announced by trusted AS" + as + ".");
            } else {
              log.add("warn", prefix + " is announced by untrusted AS" + as + "!");
            }
          }
          
        // More specific prefixes exist (someone tries to route part of our network?).
        } else {
          log.add("warn", prefix + " is not announced!");
        }
        
        if (data.data.more_specifics.length > 0) {
          log.add("warn", "Parts of " + prefix + " are also seperately announced!");
          for(p in data.data.more_specifics) {
            var o = data.data.more_specifics[p];
            log.add("warn", "Unauthorized sub-prefix " + o.prefix + " is announced by AS" + o.origin + ".");
          }
        }
        
        wrapUp();
        
      });
    })(prefix);
  }
  
}

function wrapUp() {
  if (prefixesTested < config.prefixes.length) {
    return;
  }
  
  log.add("info","All prefixes tested. Any warnings have been showed.\n");
  log.add("info","Wrapping up!");
  
  log.send();
}