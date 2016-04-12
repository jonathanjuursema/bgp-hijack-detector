// Used to gracefully exit the program.
var process = require('process');

// Configuration file.
var config = require('./config.js');
// Custom logging utility.
var log = require('./log.js');

// We need sudo rights. If not, exit.
if (process.getuid() != 0) {
  log.add("error", "You need to be root to run this program so we can send ICMP pings for better traceroute results.");
  process.exit(1);
}

// Traceroute utility.
var traceroute = (require('net-ping')).createSession();
// Rest client, used to talk with RipeSTAT.
var rest = new (require('node-rest-client').Client)();

// In this object we will store ordered hopinfo.
var hopinfo = {};
// Since we request data from RipeSTAT asynchronously, we need to keep track of whether we are already done with the traceroute.
var traceroutedone = false;

// We start by performing a traceroute to a specific host and verifying the path.
log.add("info", "Starting traceroute...");
// Call the traceroute utility. We have a large maxHopTimeouts to allow monitoring for networks that have lots of internal machines.
traceroute.traceRoute(config.host, {ttl: 30, maxHopTimeouts: 10}, parseHop, tracerouteDone);

// This function parses an individual hop.
function parseHop(error, target, ttl, send, received) {
  // Traceroutes work by sending packages with an ever increasing lifespan to request a reaction from intermediate servers relaying the package. An error means we get back the message
  // when it has reached the ttl. There could be other errors (like a non-existing address), but they will not be evaluated here.
  if (error) {
    // Package was exploded because TTL was zero, this is an intermediate hop.
    var ip = error.source;
  } else {
    // Package was successfully delivered, this noed is the end node.
    var ip = target;
  }
  
  // Usually the IP is defined (a regular hop). The else statement handels the case where the IP is not defined, e.g. a host did not send back a message on package explosion.
  if (typeof ip !== "undefined") {
    log.add("debug", "Hop: " + ip)
    
    // We add preliminary data to the hopinfo object.
    hopinfo[ip] = {'ip': ip, 'completed': false, 'as': null, 'holder': null};
    
    // We request AS information from RIPEstat.
    (function(ip) {
      rest.get("https://stat.ripe.net/data/prefix-overview/data.json?resource=" + ip, function(data, response) {
        // RIPE can provide us with an AS
        if (data.data.asns.length > 0) {
          log.add("debug", "Received RIPE announcement info for " + ip + ".");
          // We store final data to the hopinfo object.
          hopinfo[ip].as = data.data.asns[0].asn;
          hopinfo[ip].holder = data.data.asns[0].holder;
          hopinfo[ip].completed = true;
        // RIPE cannot provide us with an AS
        } else {
          // There is no data. We'll write metadata to the hopinfo object.
          log.add("debug", "RIPE tells us " + ip + " is not announced.");
          hopinfo[ip].as = -1;
          hopinfo[ip].holder = "!!! " + ip + " (Unannounced IP) !!!";
          hopinfo[ip].completed = true;
        }
        // We'll call the parseTraceroute method. (See that method for details.)
        parseTraceroute();
      });
    })(ip); // We need this strange syntax (also on other functions) because we work asynchronously and the ip variable is not accessible in that scope.
            // This way we are sure that the ip variable is accessible also in the callback of the rest client.
  } else {
    // The host did not send back either an acknowledgement or an exploded message. It is most likely a machine configured to not do this.
    log.add("warn", "Traceroute cannot ping hop!");
    ip = "0.0.0." + Object.keys(hopinfo).length;
    // Again we add metadata to the hopinfo object.
    hopinfo[ip] = {'ip': ip, 'completed': true, 'as': -2, 'holder': "!!! Unpingable Hop(s) !!!"};
  }
}

// This function signals the traceroute has finished. However, data gathering from RipeSTAT may still be under way.
function tracerouteDone(error, trgt) {  
  traceroutedone = true;
  parseTraceroute();
}

// We will now try to parse the traceroute.
function parseTraceroute() {
  
  // We'll load the individual hop IP's from the hopinfo object.
  var hops = Object.keys(hopinfo);
  
  // This code block will be called every time. First we need to check if all information gathering is complete.
  for (h in hops) {
    // Either the traceroute has not finished, or not all hopinfo children are populated with RipeSTAT data.
    if (hopinfo[hops[h]].completed == false || !traceroutedone) {
      log.add("debug", "Waiting for more information...");
      // We won't execute the rest of the function for now.
      return;
    }
  }
  
  log.add("debug", "Traceroute finished and data gathered, analyzing traceroute");
  
  // The traveled AS path, purely an array of AS numbers.
  var aspath = [];
  // The same information, but now as enriched objects. Containing AS name and such.
  var aspathinfo = [];
  
  // We loop over every hop and get the AS.
  var hops = Object.keys(hopinfo);
  for (h in hops) {    
    var as = hopinfo[hops[h]].as;
    if (as != null) {
      // We swithced AS as of the previous hop, push the new AS to the list of visited AS's.
      if (aspath[aspath.length - 1] != as) {
        aspath.push(as);
        aspathinfo.push({'as': as, 'holder': hopinfo[hops[h]].holder, 'hops': 1});
      } else {
      // We're still in the same AS. Increase the amounts of hops in this AS.
        aspathinfo[aspathinfo.length-1].hops += 1;
      }
    }
  }
  
  log.add("debug", "Verifying AS path...");
    
  // We now have a complete AS path from monitor to host. Let's compare it with the expected path.
  for (h in aspathinfo) {
    // We can still compare the AS to a configured AS.
    if (h < config.path.length) {
      // The AS number is the same as configured. This is most likely good.
      if (aspath[h] === config.path[h]) {
        log.add("info", "AS Hop "+h+" is good: "+aspath[h]+" ("+aspathinfo[h].holder+"). Hops in AS: " + aspathinfo[h].hops);
      } else {
      // The AS number differs. This means the routing AS is different than expected. It could still be routing qwirk or a recent routing change, but it could 
      // also mean traffic is rerouted illegimately.
        log.add("warn", "AS Hop "+h+" is off: was "+aspath[h]+" ("+aspathinfo[h].holder+") but should be "+config.path[h]+" ("+config.pathname[h]+"). (Is your configured path right?) Hops in AS: " + aspathinfo[h].hops);
      }
    } else {
      // We are currently processing more AS hops than expected.
      log.add("warn", "AS Hop "+h+" is unexpected, path longer than expected: "+aspath[h]+" ("+aspathinfo[h].holder+"). Hops in AS: " + aspathinfo[h].hops);
    }
  }
  // Another warning mentioning AS path lengths are different than expected.
  if (aspathinfo.length != config.path.length) {
    log.add("warn", "Path lengths are not the same! Encountered " + aspathinfo.length + " AS hops, but expected " + config.path.length + ".")
  }
  
  log.add("info", "Traceroute execution and verification is complete. Total hop count: " + Object.keys(hopinfo).length + ". Any warnings have been shown.\n");
  
  // We will now test general prefix announcement.
  testPrefixes();
  
}

// No we test prefixes. Since we again need to retrieve data from RipeSTAT we get asynchronous execution. This variable will help to see if all information has arrived yet.
var prefixesTested = 0;

// This function does the prefix testing.
function testPrefixes() {
  
  log.add("info", "We will now test prefix announcements.");
  
  // We loop over all configured prefixes.
  for(p in config.prefixes) {
    var prefix = config.prefixes[p];
    
    // We get the prefix data from RipeSTAT. We check for two things, the announcers of the prefix, and whether sub-prefixes of this prefix are also routed seperately.
    (function(prefix) {
      rest.get("https://stat.ripe.net/data/routing-status/data.json?resource=" + prefix, function(data, response) {
        prefixesTested++; // We have the result for this prefix, so we indicate one more prefix is resolved.
        
        // Prefix is announced.
        if (data.data.origins.length > 0) {
          log.add("debug", "Received RIPE info for " + prefix + ".");
          // We loop over all announcing AS's.
          for(a in data.data.origins) {
            var as = data.data.origins[a].origin;
            // We recognize the announcing AS.
            if (config.trusted.indexOf(as) > 0) {
              log.add("info", prefix + " is announced by trusted AS" + as + ".");
            } else {
            // We do not recognize the announcing as and log a warning.
              log.add("warn", prefix + " is announced by untrusted AS" + as + "!");
            }
          }
        } else {
          // For some reason nobody is announcing this prefix. Could it be the prefix is incorrect or entire network is down for a long time?
          log.add("warn", prefix + " is not announced!");
        }
        
        // More specific prefixes exist (someone tries to route part of our network?).
        if (data.data.more_specifics.length > 0) {
          // Log the warning.
          log.add("warn", "Parts of " + prefix + " are also seperately announced!");
          // Log the sub-prefixes that are also announced.
          for(p in data.data.more_specifics) {
            var o = data.data.more_specifics[p];
            log.add("warn", "Unauthorized sub-prefix " + o.prefix + " is announced by AS" + o.origin + ".");
          }
        }
        
        // We call the wrapUp function which will check if we're ready.
        wrapUp();
        
      });
    })(prefix); // This construction counteracting a scope-issue is explained earlier.
  }
  
}

// We test if we are done 
function wrapUp() {
  // If we have not yet recieved result from all prefix queries, we wait.
  if (prefixesTested < config.prefixes.length) {
    return;
  }
  
  // We're done, some final messages.
  log.add("info","All prefixes tested. Any warnings have been showed.\n");
  log.add("info","Wrapping up!");
  
  // Call the sending method, which relays any warnings to a network administrator.
  log.send();
}