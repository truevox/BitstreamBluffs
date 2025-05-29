// Minimal Phaser mock for logic-only tests
export class Scene {
  constructor() {}
}
const Phaser = { Scene };
export default {
  Scene: class {},
  Physics: {
    Matter: {
      Matter: {
        Body: {
          set: (body, property, value) => {
            // Debug log for every Body.set call
            console.log('[MOCK Body.set]', { property, value, before: body[property] });
            // Simulate Matter.Body.set by mutating the property on the body
            body[property] = value;
            console.log('[MOCK Body.set after]', { property, value, after: body[property] });
          },
          setVelocity: (body, velocity) => {
            // Simulate Matter.Body.setVelocity by mutating the velocity property
            body.velocity = { ...velocity };
          },
          applyForce: (body, position, force) => {
            // Simulate applyForce by incrementing velocity (very simplified)
            if (!body.velocity) body.velocity = { x: 0, y: 0 };
            body.velocity.x += force.x;
            body.velocity.y += force.y;
          },
          setAngle: (body, angle) => {
            body.angle = angle;
          },
          setAngularVelocity: (body, velocity) => {
            body.angularVelocity = velocity;
          },
          translate: (body, translation) => {
            body.x += translation.x;
            body.y += translation.y;
          },
        },
        Bodies: {
          circle: (x, y, radius, opts = {}) => {
            // Assign all properties directly to avoid shadowing and reference issues
            const body = {
              x,
              y,
              radius,
              velocity: { x: 0, y: 0 },
              friction: typeof opts.friction === 'number' ? opts.friction : 0,
              frictionStatic: typeof opts.frictionStatic === 'number' ? opts.frictionStatic : 0,
            };
            // Assign all other opts directly
            for (const k in opts) {
              if (k !== 'friction' && k !== 'frictionStatic') {
                body[k] = opts[k];
              }
            }
            return body;
          },
        },
      },
    },
  },
};
