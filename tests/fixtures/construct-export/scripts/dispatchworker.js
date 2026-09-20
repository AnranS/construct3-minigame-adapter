// Original handwritten fixture; not the Construct dispatch worker.
let jobPort;
self.onmessage = ({data}) => {
  if (data.type === '_init') {
    data['in-port'].onmessage = ({data: job}) => jobPort.postMessage(job);
  } else if (data.type === '_addJobWorker') {
    jobPort = data.port;
  }
};
