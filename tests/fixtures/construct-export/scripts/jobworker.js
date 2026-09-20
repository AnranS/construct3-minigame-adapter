// Original handwritten fixture; not the Construct job worker.
self.onmessage = ({data}) => {
  if (data.type !== 'init') return;
  data['dispatch-port'].onmessage = ({data: job}) => {
    const result = new Uint8Array(job.bytes.length);
    for (let i = 0; i < result.length; i++) result[i] = job.bytes[i] * 2;
    data['output-port'].postMessage({id: job.id, bytes: result}, [result.buffer]);
  };
};
