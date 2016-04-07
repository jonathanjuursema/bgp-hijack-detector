# A BGP hijack detector written in node.js.

This repository contains a BGP hijack detector written in node.js. It has been written for the course Network Security of the Cyber Security master at the University of Twente.

## About

This is a simple program that does exactly two things to monitor for possible BGP hijacks. First, it traceroutes to a specified host. It maps all hops to the AS in which the hops occur. It compares the AS path from client to host to a pre-specified path and throws a warning when the path differs. Secondly, it analyzes any number of IP prefixes for announcing AS's. It compares these AS's to a list of trusted AS's and if the prefix is announced by an untrusted AS, a warning is thrown. It also checks if sub-portions of the prefix are announced as well.

It is not necessary to integrate this program in your own BGP infrastructure. The program gets its information from [RIPEstat database](https://stat.ripe.net/). The traceroute is performed on the client itself.

This program is not intended to and not capable of detecting BGP hijacks with 100% certainty. The purpose of this program is to report fishy routing and suspicious behaviour by experiment and information checking.

## Installation

You can install the program on your system using the following commands.
```
git clone git@github.com:jonathanjuursema/bgp-hijack-detector.git
cd bgp-hijack-detector
npm install
```

## Running the program

You can run the program using `node`:
```
node sever.js
```

This program needs superuser permissions to run, since it uses ICMP traceroute as oppsed to UDP traceroutes.

If you want to run the programming at a certain interval, you can use cronjobs or another job scheduling program.
