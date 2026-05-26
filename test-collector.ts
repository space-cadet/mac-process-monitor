import si from 'systeminformation';

async function test() {
  const battery = await si.battery();
  console.log('Raw battery keys:', Object.keys(battery).sort());
  console.log('timeRemaining:', battery.timeRemaining);
  console.log('cycleCount:', battery.cycleCount);
  console.log('isCharging:', battery.isCharging);
  console.log('acConnected:', battery.acConnected);
  
  const result = {
    timeRemaining: battery.timeRemaining >= 0 ? battery.timeRemaining : null,
    cycleCount: battery.cycleCount >= 0 ? battery.cycleCount : null,
    isCharging: battery.isCharging,
    isPlugged: battery.acConnected,
  };
  console.log('Mapped result:', result);
}

test();
