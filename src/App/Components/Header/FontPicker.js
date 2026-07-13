import React, { useState } from 'react';

const FontPicker = ({ className }) => {
  const [fonts, setFonts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const loadFonts = async () => {
    if (!window.queryLocalFonts) {
      setMessage('Local font access requires a supported Chrome or Edge browser.');
      return;
    }

    setLoading(true);
    setMessage('');
    try {
      const localFonts = await window.queryLocalFonts();
      const families = Array.from(
        new Set(localFonts.map(font => font.family).filter(Boolean))
      ).sort((left, right) => left.localeCompare(right));

      setFonts(families);
      if (families.length === 0) {
        setMessage('No local fonts were returned by the browser.');
      }
    } catch (error) {
      setMessage(
        error && error.name === 'NotAllowedError'
          ? 'Local font access was denied.'
          : 'Unable to load local fonts.'
      );
    } finally {
      setLoading(false);
    }
  };

  const selectFont = event => {
    const family = event.target.value;
    if (!family) {
      document.documentElement.style.removeProperty('--markdown-font-family');
      return;
    }

    document.documentElement.style.setProperty(
      '--markdown-font-family',
      JSON.stringify(family)
    );
  };

  return (
    <div className={className}>
      <button type="button" onClick={loadFonts} disabled={loading}>
        {loading ? 'Loading…' : 'Fonts'}
      </button>
      <select aria-label="PDF font" defaultValue="" onChange={selectFont}>
        <option value="">System default</option>
        {fonts.map(font => (
          <option key={font} value={font}>
            {font}
          </option>
        ))}
      </select>
      {message && (
        <span className="font-message" title={message} aria-label={message}>
          !
        </span>
      )}
    </div>
  );
};

export default FontPicker;
