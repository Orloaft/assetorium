// Terse DOM construction helpers — keeps the editors readable without a
// framework. el("div.row", {...attrs}, ...children).

type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  selector: K | string,
  attrs: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElement {
  const [tag, ...classes] = selector.split(".");
  const node = document.createElement(tag || "div");
  if (classes.length) node.className = classes.join(" ");
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = String(v);
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === "html") node.innerHTML = String(v);
    else if (k in node && k !== "list") (node as unknown as Record<string, unknown>)[k] = v;
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

/** A labelled numeric input that calls back on change. */
export function numberField(
  label: string,
  value: number,
  onChange: (n: number) => void,
  opts: { min?: number; max?: number; step?: number; width?: number } = {}
): HTMLElement {
  const input = el("input", {
    type: "number",
    value: String(value),
    min: opts.min,
    max: opts.max,
    step: opts.step ?? 1,
    style: { width: `${opts.width ?? 64}px` },
    oninput: (e: Event) => onChange(Number((e.target as HTMLInputElement).value))
  });
  return el("label.field", {}, el("span.field-label", {}, label), input);
}

export function textField(label: string, value: string, onChange: (s: string) => void): HTMLElement {
  const input = el("input", {
    type: "text",
    value,
    oninput: (e: Event) => onChange((e.target as HTMLInputElement).value)
  });
  return el("label.field", {}, el("span.field-label", {}, label), input);
}

export function checkbox(label: string, value: boolean, onChange: (b: boolean) => void): HTMLElement {
  const input = el("input", {
    type: "checkbox",
    checked: value,
    onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked)
  });
  return el("label.check", {}, input, el("span", {}, label));
}

export function button(label: string, onClick: (e: Event) => void, cls = ""): HTMLElement {
  return el(`button.btn${cls ? "." + cls : ""}`, { onclick: onClick }, label);
}

export function select<T extends string>(
  label: string,
  value: T,
  options: Array<{ value: T; label: string }>,
  onChange: (v: T) => void
): HTMLElement {
  const sel = el("select", {
    onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value as T)
  });
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === value) opt.selected = true;
    sel.append(opt);
  }
  return el("label.field", {}, el("span.field-label", {}, label), sel);
}
