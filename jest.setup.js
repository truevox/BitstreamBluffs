// Jest setup file to mock Canvas for Phaser in jsdom environments
// This mock prevents Phaser from crashing when it calls getContext('2d') on a canvas in jsdom.
// See common-issues.md for details.

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: function (type) {
    if (type === '2d') {
      // Return a minimal mock context with just enough for Phaser to not crash
      return {
        fillStyle: '',
        fillRect: () => {},
        clearRect: () => {},
        getImageData: () => ({ data: [] }),
        putImageData: () => {},
        createImageData: () => [],
        setTransform: () => {},
        drawImage: () => {},
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        stroke: () => {},
        translate: () => {},
        scale: () => {},
        rotate: () => {},
        arc: () => {},
        fill: () => {},
        measureText: () => ({ width: 0 }),
        transform: () => {},
        rect: () => {},
        clip: () => {},
      };
    }
    return null;
  },
});
