import * as CANNON from 'cannon-es';

const rand = (a, b) => a + Math.random() * (b - a);
const HX = 10, HZ = 7, WALL_H = 20;

export function createPhysics({ onImpact } = {}) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82 * 4, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.solver.iterations = 15;

  const felt = new CANNON.Material('felt');
  const wood = new CANNON.Material('wood');
  const diceMat = new CANNON.Material('die');
  const contact = (a, b, friction, restitution) =>
    world.addContactMaterial(new CANNON.ContactMaterial(a, b, { friction, restitution }));
  contact(diceMat, felt, 0.3, 0.3);
  contact(diceMat, diceMat, 0.1, 0.4);
  contact(diceMat, wood, 0.2, 0.5);

  const floor = new CANNON.Body({ mass: 0, material: felt, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  floor.userData = { kind: 'table' };
  world.addBody(floor);

  // Walls and ceiling: thick boxes (half extents) whose inner face sits on the play area edge.
  const t = 2, hh = WALL_H / 2;
  [
    [HX + t, hh, 0, t, hh, HZ + 2 * t],
    [-HX - t, hh, 0, t, hh, HZ + 2 * t],
    [0, hh, HZ + t, HX + 2 * t, hh, t],
    [0, hh, -HZ - t, HX + 2 * t, hh, t],
    [0, WALL_H + t, 0, HX + 2 * t, t, HZ + 2 * t],
  ].forEach(([x, y, z, hx, hy, hz]) => {
    const wall = new CANNON.Body({ mass: 0, material: wood, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)) });
    wall.position.set(x, y, z);
    wall.userData = { kind: 'wall' };
    world.addBody(wall);
  });

  const dice = new Set();

  function addDie(die) {
    const body = new CANNON.Body({
      mass: die.mass,
      material: diceMat,
      linearDamping: 0.1,
      angularDamping: 0.1,
      sleepSpeedLimit: 0.6,
      sleepTimeLimit: 0.4,
    });
    body.addShape(die.shape);
    body.userData = { kind: 'die', lastImpact: 0 };
    body.addEventListener('collide', (e) => {
      if (!onImpact) return;
      const speed = Math.abs(e.contact.getImpactVelocityAlongNormal());
      const now = performance.now();
      if (speed < 0.5 || now - body.userData.lastImpact < 40) return;
      body.userData.lastImpact = now;
      onImpact(speed, e.body.userData?.kind ?? 'table');
    });
    dice.add(body);
    world.addBody(body);
    return body;
  }

  function removeDie(body) {
    dice.delete(body);
    world.removeBody(body);
  }

  function throwDie(body, index, count) {
    const f = count > 1 ? index / (count - 1) - 0.5 : 0;
    const x = f * Math.min(12, count * 2.5);
    body.position.set(x + rand(-0.3, 0.3), rand(3, 5), rand(5, 6.3));
    body.quaternion.setFromEuler(rand(0, Math.PI * 2), rand(0, Math.PI * 2), rand(0, Math.PI * 2));
    body.velocity.set(-x * 0.4 + rand(-3, 3), rand(-2, 2), -rand(7, 12)); // lands mid-table, not piled on the far wall
    body.angularVelocity.set(rand(-25, 25), rand(-25, 25), rand(-25, 25));
    body.force.setZero();
    body.torque.setZero();
    body.wakeUp();
  }

  const step = (dt) => world.step(1 / 120, dt, 5);

  // held dice are kinematic: they stay put and push thrown dice away without moving
  const allAsleep = () => [...dice].every((b) => b.type !== CANNON.Body.DYNAMIC || b.sleepState === CANNON.Body.SLEEPING);

  function setHeld(body, held) {
    body.type = held ? CANNON.Body.KINEMATIC : CANNON.Body.DYNAMIC;
    body.velocity.setZero();
    body.angularVelocity.setZero();
    body.updateMassProperties();
    if (!held) body.wakeUp();
  }

  // small hop for a die resting on an edge
  function nudge(body) {
    body.wakeUp();
    body.velocity.set(rand(-1.5, 1.5), rand(4, 6), rand(-1.5, 1.5));
    body.angularVelocity.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
  }

  return { world, addDie, removeDie, throwDie, step, allAsleep, setHeld, nudge };
}
