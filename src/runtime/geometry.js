// Geometry Interfaces Module Level 1 rectangles. These are numeric value objects;
// they do not claim a browser layout engine or native DOM node implementation.
const rectangles = new WeakMap();

function values(rectangle) {
  const result = rectangles.get(rectangle);
  if (!result) throw new TypeError('Illegal DOMRect receiver');
  return result;
}

function rectangleInit(other) {
  if (other === undefined || other === null) return [0, 0, 0, 0];
  if (typeof other !== 'object' && typeof other !== 'function') throw new TypeError('DOMRectInit must be an object');
  // Web IDL reads dictionary members in alphabetical order. Unrestricted doubles
  // retain NaN/Infinity, but ToNumber must reject BigInt and Symbol.
  const number = value => value === undefined ? 0 : +value;
  const height = number(other.height);
  const width = number(other.width);
  const x = number(other.x);
  const y = number(other.y);
  return [x, y, width, height];
}

export class DOMRectReadOnly {
  constructor(x = 0, y = 0, width = 0, height = 0) {
    rectangles.set(this, {x: +x, y: +y, width: +width, height: +height});
  }
  static fromRect(other = {}) { return new DOMRectReadOnly(...rectangleInit(other)); }
  get x() { return values(this).x; }
  get y() { return values(this).y; }
  get width() { return values(this).width; }
  get height() { return values(this).height; }
  get top() { const {y, height} = values(this); return Math.min(y, y + height); }
  get right() { const {x, width} = values(this); return Math.max(x, x + width); }
  get bottom() { const {y, height} = values(this); return Math.max(y, y + height); }
  get left() { const {x, width} = values(this); return Math.min(x, x + width); }
  toJSON() {
    const {x, y, width, height} = values(this);
    return {x, y, width, height, top: Math.min(y, y + height), right: Math.max(x, x + width),
      bottom: Math.max(y, y + height), left: Math.min(x, x + width)};
  }
  get [Symbol.toStringTag]() { return 'DOMRectReadOnly'; }
}

export class DOMRect extends DOMRectReadOnly {
  static fromRect(other = {}) { return new DOMRect(...rectangleInit(other)); }
  get x() { return values(this).x; }
  set x(value) { values(this).x = +value; }
  get y() { return values(this).y; }
  set y(value) { values(this).y = +value; }
  get width() { return values(this).width; }
  set width(value) { values(this).width = +value; }
  get height() { return values(this).height; }
  set height(value) { values(this).height = +value; }
  get [Symbol.toStringTag]() { return 'DOMRect'; }
}

// Web IDL interface members are enumerable, unlike ordinary JS class members.
for (const constructor of [DOMRectReadOnly, DOMRect]) {
  for (const name of Object.getOwnPropertyNames(constructor.prototype)) {
    if (name !== 'constructor') Object.defineProperty(constructor.prototype, name, {enumerable: true});
  }
  Object.defineProperty(constructor, 'fromRect', {enumerable: true});
}
