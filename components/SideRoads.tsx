/*
 * Decorative roads in the page gutters, only on screens wide enough that they
 * never touch content (max-w-6xl + room either side). Pure CSS, aria-hidden,
 * no pointer events; cars park in place under prefers-reduced-motion.
 */

function Car({ color, className }: { color: string; className: string }) {
  return (
    <svg viewBox="0 0 20 34" className={`road-car ${className}`}>
      <rect x="1" y="1" width="18" height="32" rx="5" fill={color} stroke="#111111" strokeWidth="2" />
      <rect x="4" y="7" width="12" height="6" rx="1.5" fill="#111111" />
      <rect x="4" y="22" width="12" height="5" rx="1.5" fill="#111111" />
      <rect x="3" y="2.5" width="4" height="2" rx="1" fill="#fde68a" />
      <rect x="13" y="2.5" width="4" height="2" rx="1" fill="#fde68a" />
    </svg>
  );
}

function Road({ side }: { side: "left" | "right" }) {
  return (
    <div className={`side-road side-road-${side}`}>
      <div className="side-road-zebra" />
      <div className="side-road-lane" />
      {side === "left" ? (
        <>
          <Car color="#0077bc" className="road-car-up" />
          <Car color="#f9fafb" className="road-car-down road-car-late" />
        </>
      ) : (
        <>
          <Car color="#009866" className="road-car-down" />
          <Car color="#d97706" className="road-car-up road-car-late" />
        </>
      )}
    </div>
  );
}

export function SideRoads() {
  return (
    <div aria-hidden="true" className="side-roads">
      <Road side="left" />
      <Road side="right" />
    </div>
  );
}
