// -----------------------------------------------------------------------------
// Scene actions (Gladys 5.1+). Both write a setting of the inverter through
// the official Open API, and both are refused while "Allow inverter control"
// is off in the configuration (the default): a scene that empties a battery
// before a power cut, or stops the feed-in, is not something to enable by
// accident. The handlers receive the fields resolved by the core (scene
// variables substituted, defaults applied).
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  set_work_mode: async (hub, { fields }) => {
    await hub.setWorkMode(fields.device, fields.mode);
    return { work_mode: fields.mode };
  },

  set_min_soc: async (hub, { fields }) => {
    const minSoc = Number(fields.min_soc);
    const minSocOnGrid = Number(fields.min_soc_on_grid);
    await hub.setMinSoc(fields.device, minSoc, minSocOnGrid);
    return { min_soc: minSoc, min_soc_on_grid: minSocOnGrid };
  },
};
