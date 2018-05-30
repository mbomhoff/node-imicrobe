const sequelize = require('../config/mysql').sequelize;
const models = require('../models');
const mongo = require('../config/mongo').mongo;
const express = require('express');
const router  = express.Router();
const Promise = require('promise');
const errors = require('./errors');
const toJsonOrError = require('./utils').toJsonOrError;
const requireAuth = require('./utils').requireAuth;
const errorOnNull = require('./utils').errorOnNull;
const logAdd = require('./utils').logAdd;

router.get('/users', function(req, res, next) {
    requireAuth(req);

    toJsonOrError(res, next,
        models.user.findAll({
            where: {
                $or: {
                    user_name: { $like: "%"+req.query.term+"%" },
                    first_name: { $like: "%"+req.query.term+"%" },
                    last_name: { $like: "%"+req.query.term+"%" }
                }
            }
        })
    );
});

router.get('/users/:id(\\d+)', function(req, res, next) {
    requireAuth(req);

    toJsonOrError(res, next,
        Promise.all([
            models.user.findOne({
                where: { user_id: req.params.id },
                include: [
                    { model: models.project,
                      through: { attributes: [] }, // remove connector table from output
                      include: [
                        { model: models.investigator,
                          through: { attributes: [] } // remove connector table from output
                        },
                        { model: models.publication },
                        { model: models.sample,
                          attributes: [
                            "sample_id",
                            "sample_name",
                            "sample_acc",
                            "sample_type",
                            [ sequelize.literal('(SELECT COUNT(*) FROM sample_file WHERE sample_file.sample_id = `projects->samples`.`sample_id`)'), 'sample_file_count' ]
                          ],
                          include: [
                            { model: models.sample_file },
                            { model: models.project
                            }
                          ]
                        }
                      ]
                    }
                ]
            }),
            mongo()
            .then( db => {
                return new Promise(function (resolve, reject) {
                    db.collection('log').find(
                        { user_id: req.params.id*1 } // ensure integer value
                    )
                    .sort({ date: 1 })
                    .toArray( (err, items) => {
                        if (err)
                            reject(err);
                        resolve(items);
                    });
                });
            })
        ])
        .then( results => {
            var user = results[0];
            user.dataValues.log = results[1];
            return user;
        })
    );
});

router.get('/users/:name([\\w\\.\\-\\_]+)', function(req, res, next) {
    requireAuth(req);

    toJsonOrError(res, next,
        models.user.findOne({
            where: { user_name: req.params.name }
        })
    );
});

router.post('/users/login', function(req, res, next) {
    requireAuth(req);

    var username = req.auth.user.user_name;
    errorOnNull(username);

    // Add user if not already present
    models.user.findOrCreate({
        where: { user_name: username }
    })
    .spread( (user, created) => {
        // For new user set first_name/last_name, or update for existing user (in case they changed them)
        models.user.update(
            { first_name: req.auth.user.first_name
            , last_name: req.auth.user.last_name
            },
            { where: { user_name: username } }
        )
        // Record login
        .then( () =>
            models.login.create({
                user_id: user.user_id,
                login_date: sequelize.fn('NOW')
            })
        )
        .then( login =>
            res.json({ // Respond w/o login_date: this is a workaround to prevent Elm decoder from failing on login_date = "fn":"NOW"
                login_id: login.login_id,
                user: user
            })
        );
    })
    .catch(next);
});

module.exports = router;