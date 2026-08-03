'use strict';

const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');

function blocked(name) {
  return function blockNetworkAccess() {
    throw new Error(`Network access blocked by sidecar-no-network-guard: ${name}`);
  };
}

function replace(target, names, prefix) {
  for (const name of names) {
    if (typeof target[name] === 'function') target[name] = blocked(`${prefix}.${name}`);
  }
}

function isLocalPipe(args) {
  const normalizedArgs = Array.isArray(args[0]) ? args[0] : args;
  const target = normalizedArgs[0];
  return (
    typeof target === 'string' ||
    (target && typeof target === 'object' && typeof target.path === 'string')
  );
}

function allowLocalPipeOnly(original, name) {
  return function guardedConnect(...args) {
    if (isLocalPipe(args)) return Reflect.apply(original, this, args);
    return blocked(name)();
  };
}

replace(http, ['get', 'request'], 'http');
replace(https, ['get', 'request'], 'https');
net.connect = allowLocalPipeOnly(net.connect, 'net.connect');
net.createConnection = allowLocalPipeOnly(net.createConnection, 'net.createConnection');
net.Socket.prototype.connect = allowLocalPipeOnly(
  net.Socket.prototype.connect,
  'net.Socket.connect'
);
replace(tls, ['connect'], 'tls');
replace(
  dns,
  ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse'],
  'dns'
);
replace(
  dns.promises,
  ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse'],
  'dns.promises'
);
replace(
  dns.Resolver.prototype,
  ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse'],
  'dns.Resolver'
);

globalThis.fetch = blocked('fetch');
