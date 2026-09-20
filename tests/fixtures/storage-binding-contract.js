// Handwritten contract fixture, not copied from a Construct export.
// The module marker and binding shape exercise the converter's public input
// contract; all classes, state and project consumers below are test inventions.

self.contractTrace = [];
class ContractBackend {
  constructor(name) {
    self.contractTrace.push(`backend:${name}`);
    this.name = name;
  }
}
class ContractAdaptor {
  constructor(backend) {
    self.contractTrace.push(`adaptor:${backend.name}`);
    this.name = backend.name;
  }
}

// ../fixture/before-storage.js
self.localforage = new ContractAdaptor(new ContractBackend('prelude'));
self.contractPrelude = self.localforage;

// ../lib/storage/localForageAdaptor.js
{
  // These similarly named members and source-like text must remain untouched.
  self.contractUnrelated = {localforage: 'unrelated object member'};
  self.contractDescription = "self.localforage = new ContractAdaptor(new ContractBackend('localforage'))";
  self['localforage'] = new ContractAdaptor(new ContractBackend('localforage'));
}

// ../fixture/project-storage-consumer.js
self.contractStore = self.localforage;
self.contractProject = self.localforage.createInstance({name: 'contract-project'});
self.contractOtherProject = self.localforage.createInstance({name: 'other-project'});
