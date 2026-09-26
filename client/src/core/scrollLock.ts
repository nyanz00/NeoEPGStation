const locks = new WeakMap<Document, { count: number; restore: () => void }>();

/** Keep the viewport gutter intact; never resize or reposition the page to lock it. */
export function acquireScrollLock(doc: Document): () => void {
    let lock = locks.get(doc);
    if (!lock) {
        const style = doc.documentElement.style;
        const properties = ['overflow-x', 'overflow-y', 'overscroll-behavior-x', 'overscroll-behavior-y'];
        const previous = properties.map(property => ({
            property,
            value: style.getPropertyValue(property),
            priority: style.getPropertyPriority(property),
        }));
        style.setProperty('overflow', 'hidden');
        style.setProperty('overscroll-behavior', 'none');
        lock = {
            count: 0,
            restore: () => {
                for (const { property, value, priority } of previous) {
                    if (value) style.setProperty(property, value, priority);
                    else style.removeProperty(property);
                }
            },
        };
        locks.set(doc, lock);
    }
    lock.count += 1;

    let released = false;
    return () => {
        if (released) return;
        released = true;
        lock.count -= 1;
        if (lock.count === 0) {
            lock.restore();
            locks.delete(doc);
        }
    };
}
