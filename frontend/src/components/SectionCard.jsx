function SectionCard({ title, children, className = "" }) {
  return (
    <section className={`section-card${className ? ` ${className}` : ""}`.trim()}>
      <h2 className="section-card__title">{title}</h2>
      <div className="section-card__body">{children}</div>
    </section>
  );
}

export default SectionCard;
