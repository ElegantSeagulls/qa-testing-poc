import colors from 'colors';

const log = (message: string) => {
  const now = new Date().toLocaleTimeString();
  console.log(`[${now}] ${message}`);    
};

export { log };
